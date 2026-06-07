import { z } from 'zod';
import { defineTool } from './types.js';
import type { PatrolJobRecord } from '../runtime/job-store.js';

const BROWSER_ERROR_LINE = /\[browser-error\]\s+(.+)$/i;

function deriveTestState(session: PatrolJobRecord): string {
  if (session.endedAt !== null) {
    if (session.exitCode === 0) return 'completed';
    if (session.status === 'cancelled') return 'cancelled';
    if (session.status === 'crashed') return 'crashed';
    return 'failed';
  }
  return session.status === 'pending' ? 'starting' : 'running';
}

function buildSummary(session: PatrolJobRecord, testState: string, errorCount: number): string {
  const elapsed = Math.round(((session.endedAt ?? Date.now()) - session.startedAt) / 1000);
  const base = `Patrol develop session ${session.id.slice(0, 8)} — ${testState} (${elapsed}s)`;
  if (errorCount > 0) return `${base}, ${errorCount} browser error(s)`;
  return base;
}

export const patrolSessionStatusTool = defineTool({
  name: 'patrol_session_status',
  description:
    'Return combined patrol develop session state in one call: test lifecycle state, recent output lines, browser errors, and a human-readable summary. Saves multiple round-trips when triaging test results.',
  inputSchema: z.object({}),
  handler(_input, ctx) {
    const session = ctx.develop.get();
    if (!session) {
      return {
        isDevelopRunning: false,
        testState: 'idle',
        summary: 'No active patrol session',
      };
    }

    const testState = deriveTestState(session);
    const tail = session.logTail;
    const recentOutput = tail.slice(-200).map((l) => ({
      ts: l.ts,
      stream: l.stream,
      text: l.text,
    }));

    const browserErrors: { ts: number; message: string }[] = [];
    for (const line of tail) {
      const m = line.text.match(BROWSER_ERROR_LINE);
      if (m && m[1]) browserErrors.push({ ts: line.ts, message: m[1] });
    }

    return {
      isDevelopRunning: true,
      taskId: session.id,
      testState,
      exitCode: session.exitCode,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      logTotal: session.logTotal,
      recentOutput,
      browserErrors,
      browserErrorCount: browserErrors.length,
      summary: buildSummary(session, testState, browserErrors.length),
    };
  },
});
