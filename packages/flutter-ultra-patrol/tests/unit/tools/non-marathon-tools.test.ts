// Unit specs for the non-spawning tools: poll, get-result, cancel,
// patrol_develop_run, patrol_hot_reload, take_patrol_screenshot,
// start/stop recording, browser-errors, web-debugger-port.
//
// All of these operate on the shared in-memory state (JobStore +
// DevelopSessionManager). We mock both so handlers are pure.

import { describe, expect, it } from 'vitest';
import { JobStore, type PatrolJobRecord } from '../../../src/runtime/job-store.js';
import { DevelopSessionManager } from '../../../src/runtime/develop-session.js';
import { pollPatrolJobTool, extractSteps } from '../../../src/tools/poll-patrol-job.js';
import { getPatrolResultTool } from '../../../src/tools/get-patrol-result.js';
import { cancelPatrolJobTool } from '../../../src/tools/cancel-patrol-job.js';
import { patrolDevelopRunTool } from '../../../src/tools/patrol-develop-run.js';
import { patrolHotReloadTool } from '../../../src/tools/patrol-hot-reload.js';
import { takePatrolScreenshotTool } from '../../../src/tools/take-patrol-screenshot.js';
import { startPatrolRecordingTool } from '../../../src/tools/start-patrol-recording.js';
import { stopPatrolRecordingTool } from '../../../src/tools/stop-patrol-recording.js';
import { getPatrolBrowserErrorsTool } from '../../../src/tools/get-patrol-browser-errors.js';
import { getPatrolWebDebuggerPortTool } from '../../../src/tools/get-patrol-web-debugger-port.js';
import { patrolDoctorTool } from '../../../src/tools/patrol-doctor.js';
import { getPatrolNativeTreeTool } from '../../../src/tools/get-patrol-native-tree.js';
import { patrolSessionStatusTool } from '../../../src/tools/patrol-session-status.js';
import type { ToolContext } from '../../../src/tools/types.js';

function makeCtx(): {
  ctx: ToolContext;
  jobs: JobStore;
  develop: DevelopSessionManager;
  writes: string[];
} {
  const jobs = new JobStore();
  const develop = new DevelopSessionManager();
  const writes: string[] = [];
  const ctx: ToolContext = {
    env: {
      patrolForkPath: '',
      stateDir: '',
      webBrowserArgs: '',
      logLevel: 'info',
    },
    jobs,
    develop,
    now: () => 1_700_000_000_000,
  };
  return { ctx, jobs, develop, writes };
}

function fakeDevelopRecord(writes: string[]): PatrolJobRecord {
  const fakeStdin = {
    destroyed: false,
    write(chunk: string): boolean {
      writes.push(chunk);
      return true;
    },
  };
  const child = {
    stdin: fakeStdin,
    pid: 99,
    killed: false,
  } as unknown as PatrolJobRecord['child'];
  return {
    id: 'develop-job',
    kind: 'develop',
    status: 'running',
    command: 'dart',
    args: ['run', 'patrol_cli', 'develop'],
    cwd: '/x',
    wrapperScript: null,
    envSnapshot: {},
    startedAt: 0,
    endedAt: null,
    exitCode: null,
    errorMessage: null,
    logTail: [],
    logTotal: 0,
    child,
  } satisfies PatrolJobRecord;
}

describe('poll_patrol_job', () => {
  it('returns found:false for unknown taskId', () => {
    const { ctx } = makeCtx();
    expect(pollPatrolJobTool.handler({ taskId: 'missing' }, ctx)).toMatchObject({
      found: false,
    });
  });

  it('returns log tail respecting limit and onlyStdout filter', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: 'a' },
      { ts: 2, stream: 'stderr', text: 'b' },
      { ts: 3, stream: 'stdout', text: 'c' },
    );
    rec.logTotal = 3;
    const got = pollPatrolJobTool.handler(
      { taskId: rec.id, logLines: 5, onlyStdout: true },
      ctx,
    ) as { logTail: { text: string }[] };
    expect(got.logTail.map((l) => l.text)).toEqual(['a', 'c']);
  });

  it('rejects invalid input', () => {
    expect(pollPatrolJobTool.inputSchema.safeParse({ taskId: '' }).success).toBe(false);
  });

  it('cursor=0 returns most recent logLines lines (fallback behaviour)', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    for (let i = 1; i <= 5; i++) {
      rec.logTail.push({ ts: i, stream: 'stdout', text: `line${i}` });
    }
    rec.logTotal = 5;
    const got = pollPatrolJobTool.handler({ taskId: rec.id, logLines: 3, cursor: 0 }, ctx) as {
      logTail: { text: string }[];
      logTotal: number;
    };
    expect(got.logTail.map((l) => l.text)).toEqual(['line3', 'line4', 'line5']);
    expect(got.logTotal).toBe(5);
  });

  it('cursor returns only new lines since last poll', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    for (let i = 1; i <= 4; i++) {
      rec.logTail.push({ ts: i, stream: 'stdout', text: `line${i}` });
    }
    rec.logTotal = 4;

    // First poll: no cursor — gets last 2 lines
    const first = pollPatrolJobTool.handler({ taskId: rec.id, logLines: 2 }, ctx) as {
      logTail: { text: string }[];
      logTotal: number;
    };
    expect(first.logTail.map((l) => l.text)).toEqual(['line3', 'line4']);

    // Two more lines arrive
    rec.logTail.push({ ts: 5, stream: 'stdout', text: 'line5' });
    rec.logTail.push({ ts: 6, stream: 'stdout', text: 'line6' });
    rec.logTotal = 6;

    // Second poll: cursor = first.logTotal (4) → only lines5 and line6
    const second = pollPatrolJobTool.handler({ taskId: rec.id, cursor: first.logTotal }, ctx) as {
      logTail: { text: string }[];
      logTotal: number;
    };
    expect(second.logTail.map((l) => l.text)).toEqual(['line5', 'line6']);
    expect(second.logTotal).toBe(6);
  });

  it('includes steps array in poll response', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: 'Running: integration_test/login_test.dart -- logs in' },
      { ts: 2, stream: 'stdout', text: 'PASS  integration_test/login_test.dart -- logs in' },
      { ts: 3, stream: 'stdout', text: 'Running: integration_test/cart_test.dart' },
    );
    rec.logTotal = 3;
    const got = pollPatrolJobTool.handler({ taskId: rec.id }, ctx) as {
      steps: { file: string; status: string }[];
    };
    expect(got.steps).toHaveLength(2);
    expect(got.steps[0]).toMatchObject({
      file: 'integration_test/login_test.dart',
      status: 'passed',
    });
    expect(got.steps[1]).toMatchObject({
      file: 'integration_test/cart_test.dart',
      status: 'running',
    });
  });
});

describe('extractSteps', () => {
  it('returns empty array for empty log', () => {
    expect(extractSteps([])).toEqual([]);
  });

  it('tracks running → passed transition', () => {
    const log = [
      {
        ts: 10,
        stream: 'stdout' as const,
        text: 'Running: integration_test/foo_test.dart -- my test',
      },
      {
        ts: 20,
        stream: 'stdout' as const,
        text: 'PASS  integration_test/foo_test.dart -- my test',
      },
    ];
    const steps = extractSteps(log);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({
      file: 'integration_test/foo_test.dart',
      test: 'my test',
      status: 'passed',
      startedAt: 10,
    });
  });

  it('tracks running → failed transition', () => {
    const log = [
      { ts: 5, stream: 'stdout' as const, text: 'Running: integration_test/bar_test.dart' },
      { ts: 15, stream: 'stdout' as const, text: 'FAIL  integration_test/bar_test.dart' },
    ];
    const steps = extractSteps(log);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 'failed', file: 'integration_test/bar_test.dart' });
  });

  it('creates step from PASS line alone (no Running: prefix)', () => {
    const log = [
      {
        ts: 1,
        stream: 'stdout' as const,
        text: 'PASS  integration_test/a_test.dart -- test name (1.5s)',
      },
    ];
    const steps = extractSteps(log);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      status: 'passed',
      file: 'integration_test/a_test.dart',
      test: 'test name',
    });
  });

  it('handles multiple independent tests', () => {
    const log = [
      { ts: 1, stream: 'stdout' as const, text: 'Running: integration_test/a_test.dart' },
      { ts: 2, stream: 'stdout' as const, text: 'Running: integration_test/b_test.dart' },
      { ts: 3, stream: 'stdout' as const, text: 'PASS  integration_test/a_test.dart' },
      { ts: 4, stream: 'stdout' as const, text: 'FAIL  integration_test/b_test.dart' },
    ];
    const steps = extractSteps(log);
    expect(steps).toHaveLength(2);
    const a = steps.find((s) => s.file === 'integration_test/a_test.dart');
    const b = steps.find((s) => s.file === 'integration_test/b_test.dart');
    expect(a?.status).toBe('passed');
    expect(b?.status).toBe('failed');
  });
});

describe('get_patrol_result', () => {
  it('returns ready:false while job is still running', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    // status remains 'pending' because no child attached.
    const got = getPatrolResultTool.handler({ taskId: rec.id }, ctx) as {
      ready: boolean;
    };
    expect(got.ready).toBe(false);
  });

  it('parses structured results once status is terminal', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    rec.status = 'completed';
    rec.endedAt = rec.startedAt + 5_000;
    rec.exitCode = 0;
    rec.logTail.push(
      { ts: 0, stream: 'stdout', text: 'PASS  integration_test/foo_test.dart' },
      { ts: 0, stream: 'stdout', text: 'FAIL  integration_test/bar_test.dart -- broke' },
      { ts: 0, stream: 'stdout', text: 'AssertionError: nope' },
    );
    const got = getPatrolResultTool.handler({ taskId: rec.id }, ctx) as {
      ready: boolean;
      passed: number;
      failed: number;
      failures: unknown[];
    };
    expect(got.ready).toBe(true);
    expect(got.passed).toBe(1);
    expect(got.failed).toBe(1);
    expect(got.failures).toHaveLength(1);
  });

  it('returns found:false for unknown taskId', () => {
    const { ctx } = makeCtx();
    expect(getPatrolResultTool.handler({ taskId: 'no' }, ctx)).toMatchObject({
      found: false,
    });
  });

  it('reports crashedBeforeTests:true with synthetic failure when status=crashed and no tests ran', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    rec.status = 'crashed';
    rec.endedAt = rec.startedAt + 1_000;
    rec.exitCode = -1;
    rec.errorMessage = 'spawn ENOENT';
    // No PASS/FAIL/SKIP lines — patrol crashed at startup.
    rec.logTail.push({ ts: 0, stream: 'stderr', text: 'Error: spawn ENOENT' });
    const got = getPatrolResultTool.handler({ taskId: rec.id }, ctx) as {
      ready: boolean;
      crashedBeforeTests: boolean;
      passed: number;
      failed: number;
      skipped: number;
      failures: { error: string }[];
    };
    expect(got.ready).toBe(true);
    expect(got.crashedBeforeTests).toBe(true);
    expect(got.passed).toBe(0);
    expect(got.failed).toBe(1);
    expect(got.skipped).toBe(0);
    expect(got.failures).toHaveLength(1);
    expect(got.failures[0]!.error).toBe('spawn ENOENT');
  });

  it('does NOT set crashedBeforeTests when failed job has test results', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    rec.status = 'failed';
    rec.endedAt = rec.startedAt + 3_000;
    rec.exitCode = 1;
    rec.logTail.push(
      { ts: 0, stream: 'stdout', text: 'PASS  integration_test/ok_test.dart' },
      { ts: 0, stream: 'stdout', text: 'FAIL  integration_test/bad_test.dart -- assert failed' },
    );
    const got = getPatrolResultTool.handler({ taskId: rec.id }, ctx) as Record<string, unknown>;
    expect(got.crashedBeforeTests).toBeUndefined();
    expect(got.failed).toBe(1);
    expect(got.passed).toBe(1);
  });

  it('diagnosticHints is null for all hints when no failures', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: { PATROL_WEB_BROWSER_ARGS: '' },
    });
    rec.status = 'completed';
    rec.endedAt = rec.startedAt + 1_000;
    rec.exitCode = 0;
    rec.logTail.push({ ts: 0, stream: 'stdout', text: 'PASS  integration_test/a_test.dart' });
    const got = getPatrolResultTool.handler({ taskId: rec.id }, ctx) as {
      diagnosticHints: {
        screenshot: string | null;
        widgetTree: string | null;
        browserErrors: string | null;
      };
    };
    expect(got.diagnosticHints.screenshot).toBeNull();
    expect(got.diagnosticHints.widgetTree).toBeNull();
    expect(got.diagnosticHints.browserErrors).toBeNull();
  });

  it('diagnosticHints.screenshot and widgetTree are populated for web test failures', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: ['test', '--web-headless', 'new'],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: { PATROL_WEB_BROWSER_ARGS: '--headless' },
    });
    rec.status = 'failed';
    rec.endedAt = rec.startedAt + 2_000;
    rec.exitCode = 1;
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: '[patrol-web-debugger-port] 9222' },
      { ts: 2, stream: 'stdout', text: 'FAIL  integration_test/x_test.dart -- broken' },
      { ts: 3, stream: 'stdout', text: 'err' },
    );
    rec.logTotal = 3;
    const got = getPatrolResultTool.handler({ taskId: rec.id }, ctx) as {
      diagnosticHints: {
        screenshot: string | null;
        widgetTree: string | null;
        browserErrors: string | null;
      };
    };
    expect(got.diagnosticHints.screenshot).toContain('take_patrol_screenshot');
    expect(got.diagnosticHints.screenshot).toContain('Headless CDP');
    expect(got.diagnosticHints.widgetTree).toContain('get_widget_tree');
    expect(got.diagnosticHints.widgetTree).toContain('9222');
  });

  it('diagnosticHints.widgetTree has no port when port not announced', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: ['test'],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: { PATROL_WEB_BROWSER_ARGS: '' },
    });
    rec.status = 'failed';
    rec.endedAt = rec.startedAt + 2_000;
    rec.exitCode = 1;
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: 'FAIL  integration_test/x_test.dart -- broken' },
      { ts: 2, stream: 'stdout', text: 'err' },
    );
    rec.logTotal = 2;
    const got = getPatrolResultTool.handler({ taskId: rec.id }, ctx) as {
      diagnosticHints: { widgetTree: string | null };
    };
    expect(got.diagnosticHints.widgetTree).toContain('get_widget_tree');
    expect(got.diagnosticHints.widgetTree).not.toContain('port');
  });

  it('diagnosticHints.browserErrors populated when failures have browser errors', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: { PATROL_WEB_BROWSER_ARGS: '' },
    });
    rec.status = 'failed';
    rec.endedAt = rec.startedAt + 1_000;
    rec.exitCode = 1;
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: '[browser-error] TypeError: foo is undefined' },
      { ts: 2, stream: 'stdout', text: 'FAIL  integration_test/x_test.dart -- broken' },
      { ts: 3, stream: 'stdout', text: 'err' },
    );
    rec.logTotal = 3;
    const got = getPatrolResultTool.handler({ taskId: rec.id }, ctx) as {
      diagnosticHints: { browserErrors: string | null };
    };
    expect(got.diagnosticHints.browserErrors).toContain('browserErrors[]');
  });

  it('diagnosticHints null for non-web test failures', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {}, // no PATROL_WEB_BROWSER_ARGS → not a web test
    });
    rec.status = 'failed';
    rec.endedAt = rec.startedAt + 1_000;
    rec.exitCode = 1;
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: 'FAIL  integration_test/x_test.dart -- broken' },
      { ts: 2, stream: 'stdout', text: 'err' },
    );
    rec.logTotal = 2;
    const got = getPatrolResultTool.handler({ taskId: rec.id }, ctx) as {
      diagnosticHints: { screenshot: string | null; widgetTree: string | null };
    };
    expect(got.diagnosticHints.screenshot).toBeNull();
    expect(got.diagnosticHints.widgetTree).toBeNull();
  });
});

describe('cancel_patrol_job', () => {
  it('reports found:false for unknown taskId', () => {
    const { ctx } = makeCtx();
    expect(cancelPatrolJobTool.handler({ taskId: 'missing' }, ctx)).toMatchObject({
      found: false,
      signalled: false,
    });
  });

  it('reports signalled:false for already-terminal jobs', () => {
    const { ctx, jobs } = makeCtx();
    const rec = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    rec.status = 'completed';
    rec.endedAt = 1;
    rec.exitCode = 0;
    expect(cancelPatrolJobTool.handler({ taskId: rec.id }, ctx)).toMatchObject({
      found: true,
      signalled: false,
    });
  });
});

describe('patrol_develop_run', () => {
  it('reports no_develop_session when none is registered', () => {
    const { ctx } = makeCtx();
    expect(patrolDevelopRunTool.handler({ testName: 'login' }, ctx)).toMatchObject({
      ok: false,
      reason: 'no_develop_session',
    });
  });

  it('writes `t <name>` to the develop session stdin', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    expect(patrolDevelopRunTool.handler({ testName: 'login flow' }, ctx)).toMatchObject({
      ok: true,
    });
    expect(writes).toEqual(['t login flow\n']);
  });

  it('sends t <name> again when same test re-dispatched', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    const first = patrolDevelopRunTool.handler({ testName: 'login' }, ctx);
    expect(first).toMatchObject({ ok: true });
    expect(writes).toEqual(['t login\n']);

    const second = patrolDevelopRunTool.handler({ testName: 'login' }, ctx);
    expect(second).toMatchObject({ ok: true });
    expect(writes).toEqual(['t login\n', 't login\n']);
  });

  it('sends t <name> for different test after first', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    const first = patrolDevelopRunTool.handler({ testName: 'login' }, ctx);
    expect(first).toMatchObject({ ok: true });

    const second = patrolDevelopRunTool.handler({ testName: 'signup' }, ctx);
    expect(second).toMatchObject({ ok: true });
    expect(writes).toEqual(['t login\n', 't signup\n']);
  });
});

describe('patrol_hot_reload', () => {
  it('sends `r` by default', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    patrolHotReloadTool.handler({}, ctx);
    expect(writes).toEqual(['r\n']);
  });

  it('sends `R` when restart:true', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    patrolHotReloadTool.handler({ restart: true }, ctx);
    expect(writes).toEqual(['R\n']);
  });

  it('reports no_develop_session when none active', () => {
    const { ctx } = makeCtx();
    expect(patrolHotReloadTool.handler({}, ctx)).toMatchObject({
      ok: false,
      reason: 'no_develop_session',
    });
  });
});

describe('take_patrol_screenshot', () => {
  it('rejects non-.png output paths', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    expect(takePatrolScreenshotTool.handler({ outputPath: '/tmp/x.jpg' }, ctx)).toMatchObject({
      ok: false,
      reason: 'invalid_output_path',
    });
  });

  it('dispatches `screenshot <path>` to develop stdin', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    expect(takePatrolScreenshotTool.handler({ outputPath: '/tmp/x.png' }, ctx)).toMatchObject({
      ok: true,
      outputPath: '/tmp/x.png',
    });
    expect(writes).toEqual(['screenshot /tmp/x.png\n']);
  });
});

describe('start/stop_patrol_recording', () => {
  it('starts a recording with sensible defaults', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    startPatrolRecordingTool.handler({ outputPath: '/tmp/run.gif' }, ctx);
    expect(writes).toEqual(['recording start gif 10 /tmp/run.gif\n']);
  });

  it('honors webm + custom fps', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    startPatrolRecordingTool.handler({ outputPath: '/tmp/r.webm', format: 'webm', fps: 30 }, ctx);
    expect(writes).toEqual(['recording start webm 30 /tmp/r.webm\n']);
  });

  it('stop sends `recording stop`', async () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    await stopPatrolRecordingTool.handler({}, ctx);
    expect(writes).toEqual(['recording stop\n']);
  });

  it('stop returns ok with no base64 when returnBase64 not set', async () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    const result = (await stopPatrolRecordingTool.handler({}, ctx)) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.base64).toBeUndefined();
  });

  it('stop returns base64Error when returnBase64:true but no recording path', async () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    // lastRecordingPath is null by default — never called setRecordingPath
    const result = (await stopPatrolRecordingTool.handler({ returnBase64: true }, ctx)) as Record<
      string,
      unknown
    >;
    expect(result.ok).toBe(true);
    expect(result.base64).toBeNull();
    expect(result.base64Error).toBe('no_recording_path');
  });

  it('stop schema accepts returnBase64 boolean', () => {
    expect(stopPatrolRecordingTool.inputSchema.safeParse({ returnBase64: true }).success).toBe(
      true,
    );
    expect(stopPatrolRecordingTool.inputSchema.safeParse({}).success).toBe(true);
  });
});

describe('get_patrol_browser_errors', () => {
  it('extracts [browser-error] lines from the warm session', () => {
    const { ctx, develop, writes } = makeCtx();
    const rec = fakeDevelopRecord(writes);
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: '[browser-error] err1' },
      { ts: 2, stream: 'stdout', text: 'unrelated line' },
      { ts: 3, stream: 'stdout', text: '[browser-error] err2' },
    );
    develop.register(rec);
    const got = getPatrolBrowserErrorsTool.handler({}, ctx) as {
      ok: boolean;
      count: number;
      errors: { ts: number; message: string }[];
    };
    expect(got.ok).toBe(true);
    expect(got.count).toBe(2);
    expect(got.errors.map((e) => e.message)).toEqual(['err1', 'err2']);
  });

  it('honors sinceMs filter', () => {
    const { ctx, develop, writes } = makeCtx();
    const rec = fakeDevelopRecord(writes);
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: '[browser-error] old' },
      { ts: 5, stream: 'stdout', text: '[browser-error] new' },
    );
    develop.register(rec);
    const got = getPatrolBrowserErrorsTool.handler({ sinceMs: 3 }, ctx) as {
      count: number;
      errors: { message: string }[];
    };
    expect(got.count).toBe(1);
    expect(got.errors[0]!.message).toBe('new');
  });

  it('merges CDP errors with stdout errors', () => {
    const { ctx, develop, writes } = makeCtx();
    const rec = fakeDevelopRecord(writes);
    rec.logTail.push(
      { ts: 100, stream: 'stdout', text: '[browser-error] stdout-err-1' },
      { ts: 300, stream: 'stdout', text: '[browser-error] stdout-err-2' },
    );
    develop.register(rec);

    // Inject mock CDP errors via private field
    const mockCapture = {
      disconnect() {},
      capturedErrors: [
        { ts: 200, level: 'error' as const, message: 'cdp-err-1', source: 'cdp' as const },
        { ts: 400, level: 'warning' as const, message: 'cdp-warn-1', source: 'cdp' as const },
      ],
    };
    (develop as unknown as { cdpCapture: unknown }).cdpCapture = mockCapture;

    const got = getPatrolBrowserErrorsTool.handler({ includeWarnings: true }, ctx) as {
      ok: boolean;
      count: number;
      cdpConnected: boolean;
      errors: { ts: number; message: string; source: string }[];
    };
    expect(got.ok).toBe(true);
    expect(got.cdpConnected).toBe(true);
    // All 4 entries: 2 stdout + 1 cdp error + 1 cdp warning
    expect(got.count).toBe(4);
    // Sorted by timestamp
    expect(got.errors.map((e) => e.message)).toEqual([
      'stdout-err-1',
      'cdp-err-1',
      'stdout-err-2',
      'cdp-warn-1',
    ]);
    expect(got.errors.map((e) => e.source)).toEqual(['stdout', 'cdp', 'stdout', 'cdp']);
  });

  it('excludes CDP warnings by default', () => {
    const { ctx, develop, writes } = makeCtx();
    const rec = fakeDevelopRecord(writes);
    develop.register(rec);

    const mockCapture = {
      disconnect() {},
      capturedErrors: [
        { ts: 100, level: 'error' as const, message: 'cdp-err', source: 'cdp' as const },
        { ts: 200, level: 'warning' as const, message: 'cdp-warn', source: 'cdp' as const },
      ],
    };
    (develop as unknown as { cdpCapture: unknown }).cdpCapture = mockCapture;

    const got = getPatrolBrowserErrorsTool.handler({}, ctx) as {
      count: number;
      errors: { message: string }[];
    };
    expect(got.count).toBe(1);
    expect(got.errors[0]!.message).toBe('cdp-err');
  });

  it('deduplicates CDP and stdout errors with same message within 1s window', () => {
    const { ctx, develop, writes } = makeCtx();
    const rec = fakeDevelopRecord(writes);
    // stdout error at ts=1000
    rec.logTail.push(
      { ts: 1000, stream: 'stdout', text: '[browser-error] TypeError: foo is undefined' },
    );
    develop.register(rec);

    // CDP error with same message at ts=1500 (within 1s dedup window of 1000)
    const mockCapture = {
      disconnect() {},
      capturedErrors: [
        { ts: 1500, level: 'error' as const, message: 'TypeError: foo is undefined', source: 'cdp' as const },
      ],
    };
    (develop as unknown as { cdpCapture: unknown }).cdpCapture = mockCapture;

    const got = getPatrolBrowserErrorsTool.handler({}, ctx) as {
      count: number;
      errors: { message: string; source: string }[];
    };
    // Same message within 1s window -- deduplicated to 1
    expect(got.count).toBe(1);
    expect(got.errors[0]!.source).toBe('stdout');
  });

  it('does not deduplicate errors with same message beyond 1s window', () => {
    const { ctx, develop, writes } = makeCtx();
    const rec = fakeDevelopRecord(writes);
    rec.logTail.push(
      { ts: 1000, stream: 'stdout', text: '[browser-error] TypeError: foo is undefined' },
    );
    develop.register(rec);

    // CDP error with same message at ts=2500 (>1s apart from 1000)
    const mockCapture = {
      disconnect() {},
      capturedErrors: [
        { ts: 2500, level: 'error' as const, message: 'TypeError: foo is undefined', source: 'cdp' as const },
      ],
    };
    (develop as unknown as { cdpCapture: unknown }).cdpCapture = mockCapture;

    const got = getPatrolBrowserErrorsTool.handler({}, ctx) as {
      count: number;
      errors: { message: string; source: string }[];
    };
    // >1s apart -- both kept
    expect(got.count).toBe(2);
  });

  it('falls back to the most recent terminal test job when no develop session', () => {
    const { ctx, jobs } = makeCtx();
    const earlier = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    earlier.endedAt = 1_000;
    earlier.status = 'completed';
    const newer = jobs.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    newer.endedAt = 2_000;
    newer.status = 'failed';
    newer.logTail.push({ ts: 1, stream: 'stdout', text: '[browser-error] late' });
    const got = getPatrolBrowserErrorsTool.handler({}, ctx) as {
      taskId: string;
      errors: { message: string }[];
    };
    expect(got.taskId).toBe(newer.id);
    expect(got.errors[0]!.message).toBe('late');
  });
});

describe('get_patrol_web_debugger_port', () => {
  it('parses [patrol-web-debugger-port] line', () => {
    const { ctx, develop, writes } = makeCtx();
    const rec = fakeDevelopRecord(writes);
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: 'Booting...' },
      { ts: 2, stream: 'stdout', text: '[patrol-web-debugger-port] 9229' },
    );
    develop.register(rec);
    expect(getPatrolWebDebuggerPortTool.handler({}, ctx)).toMatchObject({
      ok: true,
      port: 9229,
    });
  });

  it('reports port_not_announced when no line yet', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    expect(getPatrolWebDebuggerPortTool.handler({}, ctx)).toMatchObject({
      ok: false,
      reason: 'port_not_announced',
    });
  });

  it('returns no_source_job when no develop session and no taskId', () => {
    const { ctx } = makeCtx();
    expect(getPatrolWebDebuggerPortTool.handler({}, ctx)).toMatchObject({
      ok: false,
      reason: 'no_source_job',
    });
  });
});

describe('run_patrol_doctor schema', () => {
  it('accepts a valid projectRoot', () => {
    expect(patrolDoctorTool.inputSchema.safeParse({ projectRoot: '/abs/proj' }).success).toBe(true);
  });

  it('rejects missing projectRoot', () => {
    expect(patrolDoctorTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('rejects empty projectRoot', () => {
    expect(patrolDoctorTool.inputSchema.safeParse({ projectRoot: '' }).success).toBe(false);
  });

  it('has name run_patrol_doctor', () => {
    expect(patrolDoctorTool.name).toBe('run_patrol_doctor');
  });

  it('has a non-empty description', () => {
    expect(typeof patrolDoctorTool.description).toBe('string');
    expect(patrolDoctorTool.description.length).toBeGreaterThan(0);
  });

  it('handler is a function', () => {
    expect(typeof patrolDoctorTool.handler).toBe('function');
  });
});

describe('take_patrol_screenshot returnBase64 schema', () => {
  it('accepts returnBase64: true alongside outputPath', () => {
    expect(
      takePatrolScreenshotTool.inputSchema.safeParse({
        outputPath: '/tmp/x.png',
        returnBase64: true,
      }).success,
    ).toBe(true);
  });

  it('accepts returnBase64: false', () => {
    expect(
      takePatrolScreenshotTool.inputSchema.safeParse({
        outputPath: '/tmp/x.png',
        returnBase64: false,
      }).success,
    ).toBe(true);
  });

  it('accepts omitted returnBase64 (optional)', () => {
    expect(
      takePatrolScreenshotTool.inputSchema.safeParse({ outputPath: '/tmp/x.png' }).success,
    ).toBe(true);
  });

  it('when returnBase64 omitted, still dispatches screenshot command and returns ok:true', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    const result = takePatrolScreenshotTool.handler({ outputPath: '/tmp/x.png' }, ctx) as Record<
      string,
      unknown
    >;
    expect(result.ok).toBe(true);
    expect(result.base64).toBeUndefined();
  });

  it('when returnBase64:true and file does not exist, returns base64:null with base64Error', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    // Path that definitely does not exist.
    const result = takePatrolScreenshotTool.handler(
      { outputPath: '/nonexistent/path/shot.png', returnBase64: true },
      ctx,
    ) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.base64).toBeNull();
    expect(result.base64Error).toBe('file_not_yet_written');
  });
});

describe('get_patrol_native_tree', () => {
  it('returns no_develop_session when no session active', async () => {
    const { ctx } = makeCtx();
    const result = await getPatrolNativeTreeTool.handler(
      { testServerPort: 8081, compact: true },
      ctx,
    );
    expect(result).toMatchObject({ ok: false, reason: 'no_develop_session' });
  });

  it('returns test_server_unreachable when server not running', async () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    const result = await getPatrolNativeTreeTool.handler(
      { testServerPort: 59999, compact: true },
      ctx,
    );
    expect(result).toMatchObject({ ok: false, reason: 'test_server_unreachable', port: 59999 });
  });

  it('schema validates defaults', () => {
    const parsed = getPatrolNativeTreeTool.inputSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.testServerPort).toBe(8081);
      expect(parsed.data.compact).toBe(true);
    }
  });
});

describe('patrol_session_status', () => {
  it('returns idle when no develop session', () => {
    const { ctx } = makeCtx();
    const result = patrolSessionStatusTool.handler({}, ctx);
    expect(result).toMatchObject({
      isDevelopRunning: false,
      testState: 'idle',
    });
  });

  it('returns running status for active session with browser errors', () => {
    const { ctx, develop, writes } = makeCtx();
    const rec = fakeDevelopRecord(writes);
    rec.logTail.push(
      { ts: 1, stream: 'stdout', text: 'Booting up...' },
      { ts: 2, stream: 'stdout', text: '[browser-error] TypeError: foo is undefined' },
      { ts: 3, stream: 'stdout', text: 'Running test...' },
      { ts: 4, stream: 'stdout', text: '[browser-error] ReferenceError: bar' },
    );
    rec.logTotal = 4;
    rec.status = 'running';
    develop.register(rec);
    const result = patrolSessionStatusTool.handler({}, ctx) as {
      isDevelopRunning: boolean;
      testState: string;
      browserErrors: { ts: number; message: string }[];
      browserErrorCount: number;
      recentOutput: { ts: number; stream: string; text: string }[];
    };
    expect(result.isDevelopRunning).toBe(true);
    expect(result.testState).toBe('running');
    expect(result.browserErrors).toHaveLength(2);
    expect(result.browserErrors[0]!.message).toBe('TypeError: foo is undefined');
    expect(result.browserErrors[1]!.message).toBe('ReferenceError: bar');
    expect(result.browserErrorCount).toBe(2);
    expect(result.recentOutput).toHaveLength(4);
  });

  it('caps recentOutput at 200 lines', () => {
    const { ctx, develop, writes } = makeCtx();
    const rec = fakeDevelopRecord(writes);
    for (let i = 0; i < 250; i++) {
      rec.logTail.push({ ts: i, stream: 'stdout', text: `line${i}` });
    }
    rec.logTotal = 250;
    rec.status = 'running';
    develop.register(rec);
    const result = patrolSessionStatusTool.handler({}, ctx) as {
      recentOutput: unknown[];
    };
    expect(result.recentOutput).toHaveLength(200);
  });

  it('schema accepts empty object', () => {
    expect(patrolSessionStatusTool.inputSchema.safeParse({}).success).toBe(true);
  });
});
