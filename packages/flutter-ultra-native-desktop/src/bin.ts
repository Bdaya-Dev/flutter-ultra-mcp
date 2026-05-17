#!/usr/bin/env node
// MCP server binary.
//
// Invoked by Claude Code as a stdio child. Boot, install signal handlers,
// run until SIGTERM / stdin close.

import { createNativeDesktopServer } from './index.js';

async function main(): Promise<void> {
  const runtime = await createNativeDesktopServer();
  await runtime.start();

  let stopping = false;
  const stopOnce = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    runtime.server.logger.info('shutdown signal', { signal });
    try {
      await runtime.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void stopOnce('SIGTERM'));
  process.on('SIGINT', () => void stopOnce('SIGINT'));
  process.stdin.once('close', () => void stopOnce('stdin-close'));
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      server: 'flutter-ultra-native-desktop',
      msg: 'fatal',
      err: err instanceof Error ? err.stack : String(err),
    }) + '\n',
  );
  process.exit(1);
});
