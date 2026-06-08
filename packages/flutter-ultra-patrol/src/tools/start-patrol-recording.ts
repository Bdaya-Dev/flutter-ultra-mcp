// start_patrol_recording — start an animated-GIF (or webm) recording via
// the Bdaya patrol fork's CDP-based recorder.

import { z } from 'zod';
import { defineTool } from './types.js';

export const startPatrolRecordingTool = defineTool({
  name: 'start_patrol_recording',
  description:
    "Start a screen recording of the current Patrol develop session via the Bdaya fork's CDP recorder. Pair with stop_patrol_recording to finalize. Web target only.",
  inputSchema: z.object({
    outputPath: z.string().min(1).describe('Absolute path Patrol should write the recording to.'),
    format: z.enum(['gif', 'webm']).optional().describe('Output format. Defaults to gif.'),
    fps: z.number().int().positive().max(60).optional(),
  }),
  handler(input, ctx) {
    const session = ctx.develop.get();
    if (!session) return { ok: false, reason: 'no_develop_session' };
    const format = input.format ?? 'gif';
    const fps = input.fps ?? 10;
    const sent = ctx.develop.send(`recording start ${format} ${fps} ${input.outputPath}`);
    if (!sent) return { ok: false, reason: 'stdin_closed' };
    ctx.develop.setRecordingPath(input.outputPath);
    return {
      ok: true,
      taskId: session.id,
      outputPath: input.outputPath,
      format,
      fps,
      dispatchedAt: ctx.now(),
    };
  },
});
