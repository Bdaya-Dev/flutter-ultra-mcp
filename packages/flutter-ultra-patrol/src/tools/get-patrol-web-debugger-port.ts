// get_patrol_web_debugger_port — surface the CDP debugger port Patrol
// allocated for the warm web develop session. Bdaya fork commit f26306f6
// plumbs this through WebTestBackend → DevelopService → PatrolSession and
// prints it as `[patrol-web-debugger-port] <port>` on stdout at startup.

import { z } from 'zod';
import { defineTool } from './types.js';

const PORT_LINE = /\[patrol-web-debugger-port\]\s+(\d+)/i;

export const getPatrolWebDebuggerPortTool = defineTool({
  name: 'get_patrol_web_debugger_port',
  description:
    "Return the CDP debugger port allocated for the warm Patrol web develop session, so other tools (Playwright via flutter-ultra-browser, DevTools) can co-attach. Sourced from the Bdaya fork's f26306f6 PatrolSession exposure.",
  inputSchema: z.object({
    taskId: z
      .string()
      .optional()
      .describe('Optionally read from a specific job rather than the warm develop session.'),
  }),
  handler(input, ctx) {
    const job = input.taskId !== undefined ? ctx.jobs.get(input.taskId) : ctx.develop.get();
    if (!job) return { ok: false, reason: 'no_source_job' };

    let port: number | null = null;
    let observedAt: number | null = null;
    for (const line of job.logTail) {
      const m = line.text.match(PORT_LINE);
      if (m && m[1]) {
        port = Number(m[1]);
        observedAt = line.ts;
        break;
      }
    }
    if (port === null) {
      return {
        ok: false,
        reason: 'port_not_announced',
        message:
          'No [patrol-web-debugger-port] line observed in job log tail yet. The Bdaya fork emits this at web target startup — retry after the develop session reports "Web server ready".',
      };
    }
    return { ok: true, taskId: job.id, port, observedAt };
  },
});
