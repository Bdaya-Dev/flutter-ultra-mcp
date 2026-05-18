#!/usr/bin/env node
// MCP server binary for flutter-ultra-patrol.
//
// Invoked by Claude Code as a stdio child process. Creates the patrol
// server, connects stdio transport, and installs signal handlers.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPatrolServer, SERVER_NAME } from './server.js';

async function main(): Promise<void> {
  const { server, logger } = createPatrolServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('flutter-ultra-patrol ready');

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.stdin.once('close', () => shutdown('stdin-close'));
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      server: SERVER_NAME,
      msg: 'fatal',
      error: err instanceof Error ? err.message : String(err),
    }) + '\n',
  );
  process.exit(1);
});
