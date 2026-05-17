// Keep-alive — defeat the Bun-idle-SIGKILL (Claude Code issue #58004).
//
// Claude Code's Bun-based stdio host SIGKILLs idle MCP server processes
// after ~60s of silence. A harmless debug-level logging notification every
// 30s keeps the stdio pipe active without polluting the user's session.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface KeepAliveOptions {
  intervalMs?: number;
}

export function startKeepAlive(server: McpServer, options: KeepAliveOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? 30_000;
  const interval = setInterval(() => {
    server
      .sendLoggingMessage({
        level: 'debug',
        logger: 'flutter-ultra-keepalive',
        data: { ts: Date.now(), uptime: process.uptime() },
      })
      .catch(() => {
        // Stdio closed — likely shutdown in progress. Swallow.
      });
  }, intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}
