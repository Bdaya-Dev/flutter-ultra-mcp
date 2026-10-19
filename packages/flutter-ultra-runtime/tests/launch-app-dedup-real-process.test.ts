// hac#545 follow-up (PR #167 review) — launch_app's dedup kill must free
// the WHOLE process tree a launch spawned, not just the one PID it recorded
// (on Windows that's cmd.exe — launchApp.ts spawns with `shell: true` — not
// the real Flutter tool / frontend_server / Dart VM, which are its
// descendants several levels down; a flat PID kill never cascades to them
// on ANY platform, which is how hac#545's leaked processes recurred).
//
// Unlike launch-app-dedup.test.ts (which mocks `node:child_process` and
// `processTree.js` to test the DECISION of which session gets superseded),
// this file mocks NEITHER: it spawns a REAL process tree through the SAME
// `launchApp.ts` spawn path (`shell: process.platform === 'win32'`), stops
// it via the real `stopLiveSession` wiring in index.ts, and asserts a REAL
// grandchild process is actually gone afterward.
//
// RED/GREEN proof (see fix commit): reverting `index.ts`'s `stopLiveSession`
// to its pre-fix `killPid(session.pid)` (a bare single-PID
// `process.kill`) makes this test fail — the grandchild survives — on both
// Windows (cmd.exe-wrapped root) and POSIX (root's own child is never
// touched by a kill of just the root). With `killProcessTreeVerified`
// wired in, it passes.

import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { createRuntimeServer as CreateRuntimeServer } from '../src/index.js';

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  stepMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0: existence probe, sends nothing.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Windows can hold a just-killed process's cwd/file handles open for a
// brief moment after the kill call returns, making an immediate rmdir fail
// with EBUSY/EPERM — a release-timing gap, not a real failure. Retry
// bounded, keyed off the typed `err.code` (never message text), matching
// the pattern already used for this exact class of Windows flake in
// shared/state-store/src/store.ts's `renameWithRetry`.
const RM_RETRYABLE_CODES = new Set(['EBUSY', 'EPERM']);

async function rmWithRetry(path: string, maxAttempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !RM_RETRYABLE_CODES.has(code) || attempt >= maxAttempts) {
        // Leftover temp dir, not a test failure — the OS temp cleaner
        // reclaims it eventually.
        console.error('[cleanup] giving up removing', path, ':', String(err));
        return;
      }
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
}

describe('launch_app dedup kills the REAL process tree (hac#545, no mocks)', () => {
  let dataDir: string;
  let scriptDir: string;
  let prevDataDir: string | undefined;
  let prevFlutter: string | undefined;
  const realPidsToCleanUp: number[] = [];

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fu-dedup-real-data-'));
    scriptDir = mkdtempSync(join(tmpdir(), 'fu-dedup-real-scripts-'));
    prevDataDir = process.env.FLUTTER_ULTRA_DATA_DIR;
    prevFlutter = process.env.FLUTTER;
    process.env.FLUTTER_ULTRA_DATA_DIR = dataDir;

    // The grandchild: stands in for `frontend_server` / the Dart VM — a
    // long-lived process with NO relation to its parent other than being
    // its OS child. Writes its own pid to the path in argv[2], then idles.
    const grandchildPath = join(scriptDir, 'grandchild.cjs');
    writeFileSync(
      grandchildPath,
      [
        "const fs = require('node:fs');",
        'fs.writeFileSync(process.argv[2], String(process.pid));',
        'setInterval(() => {}, 1_000_000_000);',
      ].join('\n'),
      'utf8',
    );

    // The root: stands in for the REAL `flutter` tool. Spawns the
    // grandchild DETACHED (so it survives independently — exactly how
    // frontend_server/the Dart VM outlive intermediate shells in practice),
    // emits a machine-mode `app.started` line (so launchApp.ts's real
    // stdout parser drives the real attach path), then idles — matching
    // `flutter run` staying attached for the life of the session.
    const rootPath = join(scriptDir, 'root.cjs');
    writeFileSync(
      rootPath,
      [
        "const { spawn } = require('node:child_process');",
        `const grandchildPath = ${JSON.stringify(grandchildPath)};`,
        'const pidfile = process.env.FU_TEST_PIDFILE;',
        "const gc = spawn(process.execPath, [grandchildPath, pidfile], { detached: true, stdio: 'ignore' });",
        'gc.unref();',
        // Machine-mode envelope launchApp.ts's extractMachineJson() parses.
        "console.log(JSON.stringify([{ event: 'app.started', params: { vmServiceUri: 'ws://127.0.0.1:1/fake=/ws', appId: 'app1' } }]));",
        'setInterval(() => {}, 1_000_000_000);',
      ].join('\n'),
      'utf8',
    );

    // `launchApp.ts`: `flutterBin = process.env.FLUTTER ?? 'flutter'`, then
    // on win32 appends `.bat` if it has no exe/bat/cmd extension already.
    // Point FLUTTER at a bare, no-extension path so that logic resolves to
    // OUR wrapper on both platforms.
    const flutterBinBase = join(scriptDir, 'flutter-test');
    if (process.platform === 'win32') {
      writeFileSync(`${flutterBinBase}.bat`, `@echo off\r\nnode "${rootPath}" %*\r\n`, 'utf8');
    } else {
      writeFileSync(flutterBinBase, `#!/bin/sh\nexec node "${rootPath}" "$@"\n`, 'utf8');
      chmodSync(flutterBinBase, 0o755);
    }
    process.env.FLUTTER = flutterBinBase;
  });

  afterEach(async () => {
    const pids = realPidsToCleanUp.splice(0);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone — the point of the test.
      }
    }
    // Confirm they're actually dead BEFORE touching the directory tree
    // their cwd/file handles may still reference — this is what actually
    // prevents the EBUSY/EPERM below, not just a retry loop papering over
    // it. Bounded; `rmWithRetry` is still the backstop if the OS is slow
    // to release a handle even after the process itself is confirmed gone.
    try {
      await waitFor(() => pids.every((pid) => !isAlive(pid)), 5_000, 100);
    } catch {
      // Proceed anyway — rmWithRetry below is the backstop.
    }
    if (prevDataDir === undefined) delete process.env.FLUTTER_ULTRA_DATA_DIR;
    else process.env.FLUTTER_ULTRA_DATA_DIR = prevDataDir;
    if (prevFlutter === undefined) delete process.env.FLUTTER;
    else process.env.FLUTTER = prevFlutter;
    await rmWithRetry(dataDir);
    await rmWithRetry(scriptDir);
  });

  async function launchOneRealTree(
    srv: Awaited<ReturnType<typeof CreateRuntimeServer>>,
    projectDir: string,
    pidfilePath: string,
  ): Promise<{ rootPid: number; grandchildPid: number }> {
    process.env.FU_TEST_PIDFILE = pidfilePath;
    const job = await srv.launch.start({
      projectDir,
      target: 'lib/main.dart',
      device: 'windows',
    });
    if (job.pid === undefined) throw new Error('launch did not record a root pid');
    const rootPid = job.pid;
    realPidsToCleanUp.push(rootPid);

    await waitFor(() => existsSync(pidfilePath), 10_000);
    const grandchildPid = Number(readFileSync(pidfilePath, 'utf8'));
    realPidsToCleanUp.push(grandchildPid);
    expect(isAlive(grandchildPid)).toBe(true);

    return { rootPid, grandchildPid };
  }

  it('a second launch for the SAME project+device kills the first tree down to the grandchild', async () => {
    const { createRuntimeServer } = await import('../src/index.js');
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    try {
      const projectDir = join(scriptDir, 'proj');
      mkdirSync(projectDir, { recursive: true });

      const first = await launchOneRealTree(srv, projectDir, join(scriptDir, 'grandchild1.pid'));
      expect(isAlive(first.rootPid)).toBe(true);

      // Give the session-attach path (which persists `pid`/`pidStartKey`
      // onto the session record findActiveByTarget reads) a moment to
      // land before the second launch's dedup lookup runs.
      await waitFor(async () => {
        const list = await srv.sessions.list();
        return list.some((s) => s.pid === first.rootPid);
      }, 10_000);

      // SAME project+device — this must supersede (kill) the first tree
      // BEFORE spawning the second.
      await launchOneRealTree(srv, projectDir, join(scriptDir, 'grandchild2.pid'));

      // The whole first tree must be gone — root AND grandchild. A
      // single-PID kill of `first.rootPid` alone (the pre-fix behavior)
      // kills the root (cmd.exe is directly targeted) but never reaches
      // `first.grandchildPid`, which is the leak hac#545 reports.
      await waitFor(() => !isAlive(first.rootPid), 5_000);
      await waitFor(() => !isAlive(first.grandchildPid), 5_000);
    } finally {
      await srv.stop();
    }
  }, 30_000);
});
