// patrol_develop_run — execute a named test inside the warm develop
// session. Bdaya patrol fork's MCP wire format accepts `t <test-name>` on
// stdin to dispatch a single test via DevelopService.

import { z } from 'zod';
import { defineTool } from './types.js';

export const patrolDevelopRunTool = defineTool({
  name: 'patrol_develop_run',
  description:
    'Invoke a named test inside the warm patrol develop session (must call start_patrol_develop first). Much faster than a fresh `patrol test` because the Flutter app stays loaded.',
  inputSchema: z.object({
    testName: z
      .string()
      .min(1)
      .describe('Exact test name string (matched via Patrol develop dispatcher).'),
  }),
  handler(input, ctx) {
    const session = ctx.develop.get();
    if (!session) {
      return {
        ok: false,
        reason: 'no_develop_session',
        message: 'No warm develop session. Call start_patrol_develop first to spawn one.',
      };
    }
    const sent = ctx.develop.send(`t ${input.testName}`);
    if (!sent) {
      return {
        ok: false,
        reason: 'stdin_closed',
        message: 'Develop session stdin is closed; the underlying process has likely exited.',
      };
    }
    return {
      ok: true,
      taskId: session.id,
      dispatchedAt: ctx.now(),
      testName: input.testName,
    };
  },
});
