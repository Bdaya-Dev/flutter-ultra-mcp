// cancel_patrol_job — SIGTERM the child, SIGKILL after 2s if still alive.

import { z } from 'zod';
import { defineTool } from './types.js';

export const cancelPatrolJobTool = defineTool({
  name: 'cancel_patrol_job',
  description:
    'Abort an in-flight patrol job (test or develop). Sends SIGTERM then SIGKILL after a 2s grace period. Idempotent for already-terminal jobs.',
  inputSchema: z.object({
    taskId: z.string().min(1),
    gracePeriodMs: z
      .number()
      .int()
      .min(0)
      .max(60_000)
      .optional()
      .describe('Soft-kill grace period before SIGKILL (default 2000).'),
  }),
  handler(input, ctx) {
    const job = ctx.jobs.get(input.taskId);
    if (!job) return { found: false, taskId: input.taskId, signalled: false };
    const signalled = ctx.jobs.cancel(input.taskId, input.gracePeriodMs);
    if (job.kind === 'develop' && signalled) {
      ctx.develop.clear();
    }
    return {
      found: true,
      taskId: job.id,
      signalled,
      previousStatus: job.status,
    };
  },
});
