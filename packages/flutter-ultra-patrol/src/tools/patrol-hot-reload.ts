// patrol_hot_reload — send `r` (hot-reload) or `R` (hot-restart) to the
// warm develop session's stdin.

import { z } from 'zod';
import { defineTool } from './types.js';

export const patrolHotReloadTool = defineTool({
  name: 'patrol_hot_reload',
  description:
    'Hot-reload (or hot-restart with restart:true) the patrol develop session. Equivalent to typing `r` / `R` in interactive patrol develop. Requires start_patrol_develop to have been called.',
  inputSchema: z.object({
    restart: z
      .boolean()
      .optional()
      .describe('When true, performs a hot-restart (R) instead of hot-reload (r).'),
  }),
  handler(input, ctx) {
    const session = ctx.develop.get();
    if (!session) {
      return { ok: false, reason: 'no_develop_session' };
    }
    const cmd = input.restart ? 'R' : 'r';
    const sent = ctx.develop.send(cmd);
    if (!sent) return { ok: false, reason: 'stdin_closed' };
    return { ok: true, taskId: session.id, command: cmd, dispatchedAt: ctx.now() };
  },
});
