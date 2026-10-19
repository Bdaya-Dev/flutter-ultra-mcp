// hac#545 / flutter-ultra-mcp#545 — launch_app must never leave two live
// `flutter run` trees for the same project+device.
//
// Live recurrence (hac#545, 2026-10-19): the SAME lane called `launch_app`
// for the same projectDir+device twice, hours apart (across two separate
// MCP server processes — a fresh sitting restarts the server). The first
// `flutter run` tree was never stopped; it sat there holding ~2.4 GB until a
// human killed it by PID.
//
// This exercises the REAL production wiring from `createRuntimeServer()`
// (the same `sessions` + `launch` objects the `launch_app`/`stop_app` tools
// call), with `node:child_process.spawn` mocked so no real Flutter process
// is ever started, and `process.kill` spied (never actually signalling a
// real PID) so we can assert exactly what got told to die.

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked before any source under test imports 'node:child_process'.
// `execFile`/`exec` are stubbed too since portCleanup.ts / discovery.ts pull
// them from the same module at import time (never invoked on this path —
// device 'windows' is not a web device, so freePort/CDP discovery are
// skipped — but an unmocked destructure would otherwise be `undefined`).
//
// IMPORTANT: a stubbed `exec: vi.fn()` with no implementation never calls
// its callback, so anything that `promisify()`s it (processTree.ts's
// `listAllProcesses`, used by the verified tree-kill below) hangs forever,
// not just fails fast — hence also mocking processTree.js itself, below.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  exec: vi.fn(),
}));

// hac#545 follow-up (PR #167 review): the real `killProcessTreeVerified`
// enumerates the OS process table (see processTree.ts) to kill a launch's
// WHOLE descendant tree, not just one PID — correctness for that is covered
// separately by launch-app-dedup-real-process.test.ts, which spawns REAL
// processes and does NOT mock this module. Here, `FakeChildProcess` is a
// flat PID with no real OS process behind it at all, so the real
// implementation would hang (see above) or find nothing to kill; this
// suite is about the DEDUP DECISION (which session gets superseded), so
// stand in with the same single-PID behavior `killPid` used to have,
// routed through the real, spied `process.kill` so the existing assertion
// on exactly what got signalled still holds. `fakeKillRegistry` (declared
// via `vi.hoisted` so this factory can close over it) also triggers the
// matching `FakeChildProcess`'s own `kill()` — a real OS `process.kill`
// against a real PID makes Node's ChildProcess wrapper emit a real `'exit'`
// near-instantly; without mirroring that here, `stop()`'s wait-for-exit
// would stall for its full escalation timeout waiting on a PID nothing is
// actually attached to.
const { fakeKillRegistry } = vi.hoisted(() => ({
  fakeKillRegistry: new Map<number, () => void>(),
}));
vi.mock('../src/processTree.js', () => ({
  getProcessStartKey: vi.fn(async () => undefined),
  killProcessTreeVerified: vi.fn(async (rootPid: number) => {
    try {
      process.kill(rootPid, 'SIGKILL');
    } catch {
      return [];
    }
    fakeKillRegistry.get(rootPid)?.();
    return [rootPid];
  }),
}));

// The attach path (sessions.ts) opens a REAL WebSocket to the VM service to
// read isolates. Fake it — this suite is about launch_app's dedup decision,
// not the VM-service wire protocol.
vi.mock('@flutter-ultra/vm-service-client', () => {
  class FakeVmServiceClient {
    constructor(_uri: string, _opts?: unknown) {}
    async connect(): Promise<void> {}
    async streamListen(_stream: string): Promise<void> {}
    async getVM(): Promise<{ isolates: Array<{ id: string }> }> {
      return { isolates: [{ id: 'isolates/1' }] };
    }
    async dispose(): Promise<void> {}
    async callServiceExtension(): Promise<unknown> {
      return {};
    }
  }
  return { VmServiceClient: FakeVmServiceClient };
});

class FakeChildProcess extends EventEmitter {
  readonly pid: number;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = { write: vi.fn() };
  killed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
    fakeKillRegistry.set(pid, () => this.kill('SIGKILL'));
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0, signal ?? null));
    return true;
  }

  emitStdoutLine(line: string): void {
    this.stdout.emit('data', Buffer.from(line + '\n'));
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('launch_app dedup (hac#545)', () => {
  let dir: string;
  let prevDataDir: string | undefined;
  let spawnedChildren: FakeChildProcess[];
  let nextPid: number;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fu-launch-dedup-'));
    prevDataDir = process.env.FLUTTER_ULTRA_DATA_DIR;
    process.env.FLUTTER_ULTRA_DATA_DIR = dir;

    spawnedChildren = [];
    nextPid = 900_001;
    const { spawn } = await import('node:child_process');
    (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const child = new FakeChildProcess(nextPid++);
      spawnedChildren.push(child);
      return child;
    });

    // Never actually signal a real PID — just record what was asked.
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
    fakeKillRegistry.clear();
    if (prevDataDir === undefined) delete process.env.FLUTTER_ULTRA_DATA_DIR;
    else process.env.FLUTTER_ULTRA_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('documents the pre-#545 bug: with no dedup hooks, two launches leave two live processes', async () => {
    const { createLaunchService } = await import('../src/launchApp.js');
    const { createLogger } = await import('@flutter-ultra/mcp-runtime');

    const launch = createLaunchService({
      logger: createLogger({ server: 'test' }),
      onSessionReady: async () => 'unused-session-id',
      // No findLiveSessionForTarget / stopLiveSession — the old behavior.
    });

    const job1 = await launch.start({
      projectDir: 'C:\\proj',
      target: 'lib/main.dart',
      device: 'windows',
    });
    const job2 = await launch.start({
      projectDir: 'C:\\proj',
      target: 'lib/main.dart',
      device: 'windows',
    });

    expect(job1.jobId).not.toBe(job2.jobId);
    expect(spawnedChildren).toHaveLength(2);
    // Neither process was ever asked to stop — this is the leak.
    expect(spawnedChildren[0]?.killed).toBe(false);
    expect(spawnedChildren[1]?.killed).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('fix: createRuntimeServer wiring stops the previous live session before the new launch', async () => {
    const { createRuntimeServer } = await import('../src/index.js');
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });

    try {
      const job1 = await srv.launch.start({
        projectDir: 'C:\\proj',
        target: 'lib/main.dart',
        device: 'windows',
      });
      expect(spawnedChildren).toHaveLength(1);
      const child1 = spawnedChildren[0]!;

      // Simulate flutter machine-mode: app.started with a vmServiceUri.
      child1.emitStdoutLine(
        JSON.stringify([
          {
            event: 'app.started',
            params: { vmServiceUri: 'ws://127.0.0.1:1/aaa=/ws', appId: 'app1' },
          },
        ]),
      );
      await waitFor(async () => (await srv.launch.poll(job1.jobId)).sessionId !== undefined);
      const attached1 = await srv.launch.poll(job1.jobId);
      expect(attached1.sessionId).toBeDefined();

      // Second launch for the SAME projectDir + device.
      const job2 = await srv.launch.start({
        projectDir: 'C:\\proj',
        target: 'lib/main.dart',
        device: 'windows',
      });

      expect(job2.jobId).not.toBe(job1.jobId);
      // The first tree was told to die (by PID — never by command-line text).
      expect(killSpy).toHaveBeenCalledWith(child1.pid, 'SIGKILL');
      // ...and its session record reflects that, structurally.
      const sessionsAfter = await srv.sessions.list();
      const session1 = sessionsAfter.find((s) => s.id === attached1.sessionId);
      expect(session1?.status).toBe('terminated');

      // There is at most one NON-terminated session for this project+device.
      const liveForTarget = sessionsAfter.filter(
        (s) => s.status !== 'terminated' && s.projectRoot === 'C:\\proj' && s.device === 'windows',
      );
      expect(liveForTarget.length).toBeLessThanOrEqual(1);
    } finally {
      await srv.stop();
    }
  });

  it('fix: a launch for a DIFFERENT project is never stopped', async () => {
    const { createRuntimeServer } = await import('../src/index.js');
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });

    try {
      const job1 = await srv.launch.start({
        projectDir: 'C:\\proj-a',
        target: 'lib/main.dart',
        device: 'windows',
      });
      const child1 = spawnedChildren[0]!;
      child1.emitStdoutLine(
        JSON.stringify([
          {
            event: 'app.started',
            params: { vmServiceUri: 'ws://127.0.0.1:1/aaa=/ws', appId: 'app1' },
          },
        ]),
      );
      await waitFor(async () => (await srv.launch.poll(job1.jobId)).sessionId !== undefined);

      await srv.launch.start({
        projectDir: 'C:\\proj-b',
        target: 'lib/main.dart',
        device: 'windows',
      });

      expect(killSpy).not.toHaveBeenCalled();
      expect(child1.killed).toBe(false);
    } finally {
      await srv.stop();
    }
  });
});
