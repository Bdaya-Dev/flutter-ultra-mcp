#!/usr/bin/env node
// MCP server binary.
//
// Invoked by Claude Code as a stdio child process; we boot the server,
// install signal handlers, and let it run until SIGTERM / stdin close.

import { createRuntimeServer } from './index.js';

async function main(): Promise<void> {
  const runtime = await createRuntimeServer();
  await runtime.start();

  const stopOnce = async (signal: string): Promise<void> => {
    runtime.server.logger.info('shutdown signal', { signal });
    try {
      await runtime.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void stopOnce('SIGTERM'));
  process.on('SIGINT', () => void stopOnce('SIGINT'));
  // Claude Code closes stdin on shutdown.
  process.stdin.once('close', () => void stopOnce('stdin-close'));
}

main().catch((err) => {
  // Last-resort logger: stderr only; the McpServer may not be running.
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      server: 'flutter-ultra-runtime',
      msg: 'fatal',
      err: err instanceof Error ? err.stack : String(err),
    }) + '\n',
  );
  process.exit(1);
});
