// hac#545 follow-up (PR #167 review) — direct unit coverage for
// processTree.ts's own primitives, independent of launch_app's dedup
// wiring (covered end-to-end by launch-app-dedup-real-process.test.ts).
// Spawns REAL short-lived Node child processes — no mocking — to exercise
// the real OS process table.

import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectDescendants,
  getProcessStartKey,
  killProcessTreeVerified,
  listAllProcesses,
  type ProcessSnapshot,
} from '../src/processTree.js';

function spawnIdleChild(): { pid: number; kill: () => void } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000_000_000)'], {
    stdio: 'ignore',
  });
  if (child.pid === undefined) throw new Error('spawn did not return a pid');
  return {
    pid: child.pid,
    kill: () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    },
  };
}

describe('processTree', () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
  });

  it('listAllProcesses finds this test runner process itself', async () => {
    const all = await listAllProcesses();
    const self = all.find((p) => p.pid === process.pid);
    expect(self).toBeDefined();
    expect(self?.startKey).toBeTruthy();
  }, 15_000);

  it('getProcessStartKey finds a real pid, returns undefined for an implausible one', async () => {
    const key = await getProcessStartKey(process.pid);
    expect(key).toBeTruthy();
    const bogus = await getProcessStartKey(999_999_999);
    expect(bogus).toBeUndefined();
  }, 15_000);

  it('killProcessTreeVerified kills a real process it finds with no expected key', async () => {
    const target = spawnIdleChild();
    cleanup.push(target.kill);
    const result = await killProcessTreeVerified(target.pid);
    expect(result.confident).toBe(true);
    expect(result.killed).toContain(target.pid);
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(target.pid, 0)).toThrow();
  }, 15_000);

  it('killProcessTreeVerified NEVER touches a live PID whose start identity does not match the recorded one (PID-reuse guard)', async () => {
    // Two genuinely separate, currently-alive processes. Deliberately pass
    // B's pid paired with A's startKey — a mismatched-but-both-real pair,
    // simulating "the PID we recorded got reused by someone else" — and
    // confirm B survives untouched.
    //
    // The POSIX `startKey` is `ps`'s `lstart` field, which only has
    // SECOND resolution on both GNU (Linux) and BSD (macOS) ps — spawning
    // A and B back-to-back can land them in the SAME second, making their
    // real startKeys coincidentally equal and defeating the very guard
    // this test exists to prove (confirmed live on ubuntu-latest/
    // macos-latest CI: `lstart` collided, the guard treated B as "the same
    // process" as A, and killed it). A >1s gap guarantees their `lstart`
    // values differ — matching the real-world threat model this guards
    // against anyway (a PID recorded possibly minutes/hours earlier being
    // reused by an unrelated process in the SAME calendar second as that
    // original recording is not a realistic collision; two helpers spawned
    // milliseconds apart in a tight test loop is the unrealistic one).
    const a = spawnIdleChild();
    await new Promise((r) => setTimeout(r, 1_100));
    const b = spawnIdleChild();
    cleanup.push(a.kill, b.kill);

    const aKey = await getProcessStartKey(a.pid);
    const bKey = await getProcessStartKey(b.pid);
    expect(aKey).toBeTruthy();
    expect(bKey).toBeTruthy();
    expect(aKey).not.toBe(bKey);

    const result = await killProcessTreeVerified(b.pid, aKey);
    expect(result.confident).toBe(true);
    expect(result.killed).toEqual([]);

    // B must still be alive — the guard refused to touch it.
    expect(() => process.kill(b.pid, 0)).not.toThrow();
  }, 15_000);

  it('killProcessTreeVerified kills a real process when the expected key DOES match', async () => {
    const target = spawnIdleChild();
    cleanup.push(target.kill);
    const key = await getProcessStartKey(target.pid);
    expect(key).toBeTruthy();

    const result = await killProcessTreeVerified(target.pid, key);
    expect(result.confident).toBe(true);
    expect(result.killed).toContain(target.pid);
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(target.pid, 0)).toThrow();
  }, 15_000);

  // hac#545 follow-up (PR #167 round-3 review) — collectDescendants's own
  // guards against adversarial ppid graphs, which can't be reliably
  // engineered with real OS processes (you can't make the OS hand out a
  // specific stale/reused ppid on demand): synthetic ProcessSnapshot[]
  // fixtures instead. See collectDescendants's doc comment for the
  // primary sources (microsoft/dcp#274, #278) behind both guards.
  describe('collectDescendants (synthetic ppid graphs)', () => {
    function snap(pid: number, ppid: number, startTimeMs: number): ProcessSnapshot {
      return { pid, ppid, startKey: String(startTimeMs), startTimeMs };
    }

    it('terminates on a ppid cycle instead of looping forever', () => {
      // A claims to be B's child; B claims to be A's child. Neither
      // relationship is real (both are stale ParentProcessId values left
      // over from processes that no longer exist) — the visited set must
      // stop the walk rather than bounce between them forever.
      const all = [snap(100, 200, 1_000), snap(200, 100, 1_000)];
      const result = collectDescendants(all, 100);
      expect(result.map((p) => p.pid).sort()).toEqual([100, 200]);
    });

    it('rejects a candidate descendant whose start time predates its claimed parent (stale-ppid guard)', () => {
      // 300 is OUR verified root, started at t=2000. 400 claims ppid=300,
      // but started at t=1000 — BEFORE 300 existed. 400 cannot possibly
      // be 300's real child; its ParentProcessId=300 is a stale leftover
      // from a DIFFERENT, long-gone process that used to hold pid 300,
      // reused since. Per microsoft/dcp#274: "stale parent PID can point
      // at an unrelated process" — this must never be treated as ours.
      const root = snap(300, 1, 2_000);
      const unrelated = snap(400, 300, 1_000);
      const all = [root, unrelated];
      const result = collectDescendants(all, 300);
      expect(result.map((p) => p.pid)).toEqual([300]);
    });

    it('accepts a genuine descendant whose start time is at/after its parent', () => {
      const root = snap(500, 1, 1_000);
      const child = snap(600, 500, 1_000); // same instant is fine (>=)
      const grandchild = snap(700, 600, 1_500);
      const all = [root, child, grandchild];
      const result = collectDescendants(all, 500);
      expect(result.map((p) => p.pid).sort()).toEqual([500, 600, 700]);
    });

    it('excludes a candidate with an unparseable/NaN start time (fails safe)', () => {
      const root = snap(800, 1, 1_000);
      const unknown: ProcessSnapshot = {
        pid: 900,
        ppid: 800,
        startKey: 'garbage',
        startTimeMs: NaN,
      };
      const all = [root, unknown];
      const result = collectDescendants(all, 800);
      expect(result.map((p) => p.pid)).toEqual([800]);
    });
  });
});
