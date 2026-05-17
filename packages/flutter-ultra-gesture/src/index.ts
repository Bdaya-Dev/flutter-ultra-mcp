#!/usr/bin/env node
// flutter-ultra-gesture MCP server entrypoint.
//
// Stdio transport. Tools call `ext.flutter.ultra.*` service extensions in a
// running Flutter app, addressed by the runtime server's `sessions.json`.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGestureServer } from './server.js';

export const SERVER_NAME = 'flutter-ultra-gesture';

async function main(): Promise<void> {
  const server = createGestureServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[${SERVER_NAME}] connected via stdio transport\n`);
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  // ESM main-module check: argv[1] resolves to the entry script path.
  // Compare against import.meta.url so `node dist/index.js` runs main(),
  // but importing this module from tests does not.
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isDirectInvocation) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `[${SERVER_NAME}] fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
}
