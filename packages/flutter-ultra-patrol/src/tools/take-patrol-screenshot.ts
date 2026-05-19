// take_patrol_screenshot — capture screenshot via Patrol's CDP integration
// (Bdaya fork commit f26306f6). Talks to the warm develop session by
// sending the `screenshot` directive on stdin; the patrol develop process
// forwards to its CDP service and writes the PNG to outputPath.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { defineTool } from './types.js';

export const takePatrolScreenshotTool = defineTool({
  name: 'take_patrol_screenshot',
  description:
    "Capture a screenshot of the current Patrol develop session via the Bdaya fork's CDP integration. Requires start_patrol_develop. Returns the on-disk path Patrol wrote to (resolution by Patrol; we surface the command we dispatched + the absolute path Patrol uses). Optionally returns the PNG as a base64 string to eliminate a round-trip read.",
  inputSchema: z.object({
    outputPath: z
      .string()
      .min(1)
      .describe(
        'Absolute path Patrol should write the PNG to. Must end in .png. Directory must exist.',
      ),
    returnBase64: z
      .boolean()
      .optional()
      .describe(
        'When true, read the saved PNG and include its base64 content in the response. Eliminates a round-trip file read for the agent.',
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

    const base = {
      ok: true,
      taskId: session.id,
      outputPath: input.outputPath,
      dispatchedAt: ctx.now(),
    };

    if (input.returnBase64) {
      try {
        const data = readFileSync(input.outputPath);
        return { ...base, base64: data.toString('base64'), mimeType: 'image/png' };
      } catch {
        // File not yet written (Patrol writes asynchronously after the command
        // is dispatched). Return without base64; caller should poll or wait.
        return { ...base, base64: null, base64Error: 'file_not_yet_written' };
      }
    }

    return base;
  },
});
