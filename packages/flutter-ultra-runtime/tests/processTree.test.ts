// hac#545 follow-up (PR #167 review) — direct unit coverage for
// processTree.ts's own primitives, independent of launch_app's dedup
// wiring (covered end-to-end by launch-app-dedup-real-process.test.ts).
// Spawns REAL short-lived Node child processes — no mocking — to exercise
// the real OS process table.

import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getProcessStartKey,
  killProcessTreeVerified,
  listAllProcesses,
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
    const killed = await killProcessTreeVerified(target.pid);
    expect(killed).toContain(target.pid);
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

    const killed = await killProcessTreeVerified(b.pid, aKey);
    expect(killed).toEqual([]);

    // B must still be alive — the guard refused to touch it.
    expect(() => process.kill(b.pid, 0)).not.toThrow();
  }, 15_000);

  it('killProcessTreeVerified kills a real process when the expected key DOES match', async () => {
    const target = spawnIdleChild();
    cleanup.push(target.kill);
    const key = await getProcessStartKey(target.pid);
    expect(key).toBeTruthy();

    const killed = await killProcessTreeVerified(target.pid, key);
    expect(killed).toContain(target.pid);
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(target.pid, 0)).toThrow();
  }, 15_000);
});
