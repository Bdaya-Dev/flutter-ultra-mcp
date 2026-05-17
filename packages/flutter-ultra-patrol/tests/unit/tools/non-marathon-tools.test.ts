// Unit specs for the non-spawning tools: poll, get-result, cancel,
// patrol_develop_run, patrol_hot_reload, take_patrol_screenshot,
// start/stop recording, browser-errors, web-debugger-port.
//
// All of these operate on the shared in-memory state (JobStore +
// DevelopSessionManager). We mock both so handlers are pure.

import { describe, expect, it } from 'vitest';
import { JobStore, type PatrolJobRecord } from '../../../src/runtime/job-store.js';
import { DevelopSessionManager } from '../../../src/runtime/develop-session.js';
import { pollPatrolJobTool } from '../../../src/tools/poll-patrol-job.js';
import { getPatrolResultTool } from '../../../src/tools/get-patrol-result.js';
import { cancelPatrolJobTool } from '../../../src/tools/cancel-patrol-job.js';
import { patrolDevelopRunTool } from '../../../src/tools/patrol-develop-run.js';
import { patrolHotReloadTool } from '../../../src/tools/patrol-hot-reload.js';
import { takePatrolScreenshotTool } from '../../../src/tools/take-patrol-screenshot.js';
import { startPatrolRecordingTool } from '../../../src/tools/start-patrol-recording.js';
import { stopPatrolRecordingTool } from '../../../src/tools/stop-patrol-recording.js';
import { getPatrolBrowserErrorsTool } from '../../../src/tools/get-patrol-browser-errors.js';
import { getPatrolWebDebuggerPortTool } from '../../../src/tools/get-patrol-web-debugger-port.js';
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

  it('stop sends `recording stop`', () => {
    const { ctx, develop, writes } = makeCtx();
    develop.register(fakeDevelopRecord(writes));
    stopPatrolRecordingTool.handler({}, ctx);
    expect(writes).toEqual(['recording stop\n']);
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
