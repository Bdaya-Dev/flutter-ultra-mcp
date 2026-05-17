// get_patrol_browser_errors — return CDP-captured browser console errors
// from the current / last test. Bdaya fork commit b591a390 routes Chrome
// console.error + uncaught exception lines as `[browser-error] <msg>` in
// the develop session's stdout. We harvest them from the active job log
// tail (current session) or the most recent terminal test job.

import { z } from 'zod';
import { defineTool } from './types.js';
import type { ToolContext } from './types.js';

const BROWSER_ERROR_LINE = /\[browser-error\]\s+(.+)$/i;

export const getPatrolBrowserErrorsTool = defineTool({
  name: 'get_patrol_browser_errors',
  description:
    "Return CDP-captured browser console errors (incl. uncaught exceptions) from the active patrol develop session, or the most-recent completed test job if no develop session is active. Uses the Bdaya fork's b591a390 CDP error surface.",
  inputSchema: z.object({
    sinceMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Drop log entries with ts < sinceMs (epoch milliseconds).'),
    /**
     * When set, ignore the warm develop session and read from a specific
     * test taskId. Useful for the typical "test failed; what did the
     * browser say?" pattern.
     */
    taskId: z.string().optional(),
  }),
  handler(input, ctx) {
    const job = resolveSource(input.taskId, ctx);
    if (!job) {
      return { ok: false, reason: 'no_source_job' };
    }
    const since = input.sinceMs ?? 0;
    const errors: { ts: number; message: string }[] = [];
    for (const line of job.logTail) {
      if (line.ts < since) continue;
      const m = line.text.match(BROWSER_ERROR_LINE);
      if (m && m[1]) errors.push({ ts: line.ts, message: m[1] });
    }
    return {
      ok: true,
      taskId: job.id,
      kind: job.kind,
      count: errors.length,
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
