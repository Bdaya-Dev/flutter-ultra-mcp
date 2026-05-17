#!/usr/bin/env node
// Executable entrypoint. The `.mcp.json` line for this server points here.

import { createNativeMobileServer } from './index.js';

async function main(): Promise<void> {
  const app = await createNativeMobileServer();

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.server.logger.info('shutdown signal', { signal });
    try {
      await app.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.start();
}

main().catch((err) => {
  // stderr only — stdout is the MCP JSON-RPC framing channel.
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`flutter-ultra-native-mobile fatal: ${msg}\n`);
  process.exit(1);
});
