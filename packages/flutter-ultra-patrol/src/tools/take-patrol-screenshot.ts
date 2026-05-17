// take_patrol_screenshot — capture screenshot via Patrol's CDP integration
// (Bdaya fork commit f26306f6). Talks to the warm develop session by
// sending the `screenshot` directive on stdin; the patrol develop process
// forwards to its CDP service and writes the PNG to outputPath.

import { z } from 'zod';
import { defineTool } from './types.js';

export const takePatrolScreenshotTool = defineTool({
  name: 'take_patrol_screenshot',
  description:
    "Capture a screenshot of the current Patrol develop session via the Bdaya fork's CDP integration. Requires start_patrol_develop. Returns the on-disk path Patrol wrote to (resolution by Patrol; we surface the command we dispatched + the absolute path Patrol uses).",
  inputSchema: z.object({
    outputPath: z
      .string()
      .min(1)
      .describe(
        'Absolute path Patrol should write the PNG to. Must end in .png. Directory must exist.',
      ),
  }),
  handler(input, ctx) {
    const session = ctx.develop.get();
    if (!session) return { ok: false, reason: 'no_develop_session' };
    if (!input.outputPath.toLowerCase().endsWith('.png')) {
      return {
        ok: false,
        reason: 'invalid_output_path',
        message: 'outputPath must end in .png',
      };
    }
    // The Bdaya fork's MCP protocol command is `screenshot <abs-path>`.
    const sent = ctx.develop.send(`screenshot ${input.outputPath}`);
    if (!sent) return { ok: false, reason: 'stdin_closed' };
    return {
      ok: true,
      taskId: session.id,
      outputPath: input.outputPath,
      dispatchedAt: ctx.now(),
    };
  },
});
