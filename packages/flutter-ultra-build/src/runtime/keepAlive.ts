/**
 * Bun-idle-SIGKILL workaround (plan §17.9, claude-code #58004).
 *
 * Sends a `notifications/message` at `debug` level every 30s so the stdio
 * pipe stays active and Claude Code's Bun transport doesn't SIGKILL us at the
 * 60s idle mark.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SERVER_NAME } from '../constants.js';

const DEFAULT_INTERVAL_MS = 30_000;

export function startKeepAlive(server: McpServer, intervalMs = DEFAULT_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    server.server
      .sendLoggingMessage({
        level: 'debug',
        logger: `${SERVER_NAME}-keepalive`,
        data: { ts: Date.now(), uptimeS: Math.round(process.uptime()) },
      })
      .catch(() => {
        // Stdio closed — shutdown in progress.
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
