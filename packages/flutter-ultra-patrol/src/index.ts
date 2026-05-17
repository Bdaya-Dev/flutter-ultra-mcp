#!/usr/bin/env node
// flutter-ultra-patrol MCP server — entrypoint.
//
// Wave 2 / task #11. Exposes 13 tools (plan §17B.1) that orchestrate
// patrol_cli E2E tests. Bundles the Bdaya patrol fork at vendor/patrol/
// via pubspec_overrides; for spawn purposes the fork is consumed through
// `dart run patrol_cli` from the project root.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPatrolServer, SERVER_NAME } from './server.js';

export { SERVER_NAME, SERVER_VERSION, TOOLS, createPatrolServer } from './server.js';
export { readEnv } from './runtime/env.js';
export { JobStore } from './runtime/job-store.js';
export { DevelopSessionManager } from './runtime/develop-session.js';

async function main(): Promise<void> {
  const { server, logger } = createPatrolServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('flutter-ultra-patrol ready');

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info('shutting down', { signal });
    server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only auto-run when invoked as the process entrypoint. Importers
// (vitest tests, future re-exports) get the named exports without
// spawning a stdio transport.
const isEntry =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isEntry) {
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
}
