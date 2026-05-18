#!/usr/bin/env node
// MCP server binary for flutter-ultra-gesture.
//
// Invoked by Claude Code as a stdio child process. Creates the gesture
// server, connects stdio transport, and installs signal handlers.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGestureServer } from './server.js';

const SERVER_NAME = 'flutter-ultra-gesture';

async function main(): Promise<void> {
  const server = createGestureServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[${SERVER_NAME}] connected via stdio transport\n`);

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`[${SERVER_NAME}] shutdown: ${signal}\n`);
    try {
      await server.close();
    } catch {
      // already closed
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.stdin.once('close', () => void shutdown('stdin-close'));
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[${SERVER_NAME}] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
