#!/usr/bin/env node
// MCP server binary for flutter-ultra-browser.
//
// Invoked by Claude Code as a stdio child process. Always starts — the
// bootstrap itself is main() in index.ts, shared with tests and importers.

import { main } from './index.js';
import { log } from './logger.js';

main().catch((err) => {
  log.error('fatal', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
