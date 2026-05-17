// poll_patrol_job — non-blocking status read for a marathon job.

import { z } from 'zod';
import { defineTool } from './types.js';
import type { JobLogLine } from '../runtime/job-store.js';

export const pollPatrolJobTool = defineTool({
  name: 'poll_patrol_job',
  description:
    'Return current status, exit code, last log lines, and rolling counters for a marathon Patrol job (started by start_patrol_test or start_patrol_develop). Non-blocking.',
  inputSchema: z.object({
    taskId: z.string().min(1),
    /** Max log lines to return from the tail buffer. */
    logLines: z
      .number()
      .int()
      .min(0)
      .max(500)
      .optional()
      .describe('Max log lines from rolling tail (default 100).'),
    /** When true, drops stderr lines from the returned slice. */
    onlyStdout: z.boolean().optional(),
  }),
  handler(input, ctx) {
    const job = ctx.jobs.get(input.taskId);
    if (!job) {
      return { found: false, taskId: input.taskId };
    }
    const limit = input.logLines ?? 100;
    const tail: JobLogLine[] = filterTail(job.logTail, input.onlyStdout);
    const sliced = tail.slice(Math.max(0, tail.length - limit));
    return {
      found: true,
      taskId: job.id,
      kind: job.kind,
      status: job.status,
      command: job.command,
      args: job.args,
      cwd: job.cwd,
      wrapperScript: job.wrapperScript,
      pid: job.child?.pid ?? null,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      durationMs: (job.endedAt ?? Date.now()) - job.startedAt,
      exitCode: job.exitCode,
      errorMessage: job.errorMessage,
      logTotal: job.logTotal,
      logTail: sliced,
    };
  },
});

function filterTail(tail: JobLogLine[], onlyStdout: boolean | undefined): JobLogLine[] {
  if (!onlyStdout) return tail;
  return tail.filter((l) => l.stream === 'stdout');
}
