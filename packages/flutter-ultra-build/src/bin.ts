#!/usr/bin/env node
// MCP server binary for flutter-ultra-build.
//
// Invoked by Claude Code as a stdio child process. Always starts — a
// main-module guard would compare `import.meta.url` against `process.argv[1]`,
// and those diverge when the bundle is spawned through a symlink/junction
// (Node resolves the main module's realpath while argv[1] keeps the link
// path), silently exiting 0 before the MCP handshake.

import { main } from './index.js';
import { log } from './runtime/logger.js';

main().catch((err: unknown) => {
  log.error('fatal in main', {
    err: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
  process.exit(1);
});
