// get_patrol_browser_errors — return CDP-captured browser console errors
// from the current / last test. Bdaya fork commit b591a390 routes Chrome
// console.error + uncaught exception lines as `[browser-error] <msg>` in
// the develop session's stdout. We harvest them from the active job log
// tail (current session) or the most recent terminal test job.

import { z } from 'zod';
import { defineTool } from './types.js';
import type { ToolContext } from './types.js';

const BROWSER_ERROR_LINE = /\[browser-error\]\s+(.+)$/i;

interface BrowserError {
  ts: number;
  level: 'error' | 'warning';
  message: string;
  source: 'stdout' | 'cdp';
}

function deduplicateErrors(errors: BrowserError[]): BrowserError[] {
  errors.sort((a, b) => a.ts - b.ts);
  const result: BrowserError[] = [];
  for (const err of errors) {
    const isDupe = result.some(
      (existing) =>
        Math.abs(existing.ts - err.ts) < 1_000 &&
        existing.message === err.message,
    );
    if (!isDupe) result.push(err);
  }
  return result;
}

export const getPatrolBrowserErrorsTool = defineTool({
  name: 'get_patrol_browser_errors',
  description:
    "Return browser console errors (incl. uncaught exceptions) from the active patrol develop session, or the most-recent completed test job. Merges stdout-parsed [browser-error] lines with structured CDP WebSocket capture when available.",
  inputSchema: z.object({
    sinceMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Drop log entries with ts < sinceMs (epoch milliseconds).'),
    taskId: z.string().optional(),
    includeWarnings: z
      .boolean()
      .optional()
      .describe('Include warning-level entries from CDP capture. Defaults to false.'),
  }),
  handler(input, ctx) {
    const job = resolveSource(input.taskId, ctx);
    if (!job) {
      return { ok: false, reason: 'no_source_job' };
    }
    const since = input.sinceMs ?? 0;
    const merged: BrowserError[] = [];

    for (const line of job.logTail) {
      if (line.ts < since) continue;
      const m = line.text.match(BROWSER_ERROR_LINE);
      if (m?.[1]) {
        merged.push({ ts: line.ts, level: 'error', message: m[1], source: 'stdout' });
      }
    }

    for (const cdpErr of ctx.develop.cdpErrors) {
      if (cdpErr.ts < since) continue;
      if (cdpErr.level === 'warning' && !input.includeWarnings) continue;
      merged.push({ ts: cdpErr.ts, level: cdpErr.level, message: cdpErr.message, source: 'cdp' });
    }

    const errors = deduplicateErrors(merged);
    return {
      ok: true,
      taskId: job.id,
      kind: job.kind,
      count: errors.length,
      cdpConnected: ctx.develop.cdpErrors.length > 0 || merged.some((e) => e.source === 'cdp'),
      errors,
    };
  },
});

function resolveSource(
  explicitTaskId: string | undefined,
  ctx: ToolContext,
): ReturnType<typeof ctx.jobs.get> {
  if (explicitTaskId) return ctx.jobs.get(explicitTaskId);
  const session = ctx.develop.get();
  if (session) return session;
  // Fall back to most-recently-ended test job.
  const tests = ctx.jobs.list().filter((j) => j.kind === 'test' && j.endedAt !== null);
  tests.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return tests[0];
}
