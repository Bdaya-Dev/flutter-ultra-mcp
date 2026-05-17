// get_patrol_result — finalize a completed test job; parse structured
// pass/fail/skipped counts + failure diagnostics.

import { z } from 'zod';
import { defineTool } from './types.js';
import { parseTestResults } from '../util/results-parser.js';

export const getPatrolResultTool = defineTool({
  name: 'get_patrol_result',
  description:
    'Return the final structured result for a completed patrol test job: {passed, failed, skipped, durations, failures: [{test, error, stackTrace, lastScreenshot, browserErrors[]}]}. Returns {ready:false} if the job is still running.',
  inputSchema: z.object({
    taskId: z.string().min(1),
  }),
  handler(input, ctx) {
    const job = ctx.jobs.get(input.taskId);
    if (!job) return { found: false, taskId: input.taskId };
    const terminal =
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'crashed';
    if (!terminal) {
      return {
        found: true,
        ready: false,
        taskId: job.id,
        status: job.status,
      };
    }
    const durationMs = (job.endedAt ?? ctx.now()) - job.startedAt;
    const result = parseTestResults(job.logTail, durationMs);
    return {
      found: true,
      ready: true,
      taskId: job.id,
      status: job.status,
      exitCode: job.exitCode,
      errorMessage: job.errorMessage,
      command: job.command,
      args: job.args,
      ...result,
    };
  },
});
