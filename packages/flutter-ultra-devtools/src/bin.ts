#!/usr/bin/env node
// MCP server binary for flutter-ultra-devtools.
//
// Invoked by Claude Code as a stdio child process. Always starts — a
// main-module guard would compare `import.meta.url` against `process.argv[1]`,
// and those diverge when the bundle is spawned through a symlink/junction
// (Node resolves the main module's realpath while argv[1] keeps the link
// path), silently exiting 0 before the MCP handshake.

import { server } from './index.js';

server.start().catch((err: unknown) => {
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      server: 'flutter-ultra-devtools',
      msg: 'fatal',
      err: err instanceof Error ? err.stack : String(err),
    }) + '\n',
  );
  process.exit(1);
});
