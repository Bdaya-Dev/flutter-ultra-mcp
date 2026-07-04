// E2E: every bundled MCP server must boot as a real spawned process and answer
// `initialize` — both from its direct path and through a symlink/junction.
//
// The symlink case reproduces the Claude Code plugin-cache layout under
// multi-profile setups where the per-profile plugins directory is a
// junction/symlink to a shared cache: Node resolves the main module's realpath
// while process.argv[1] keeps the link path, so a main-module guard comparing
// import.meta.url to argv[1] exits 0 silently before the MCP handshake.
// In-process createServer() tests can never catch that class.

import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawnMcpClient, type McpClient } from './mcp-client.js';

const ROOT = resolve(import.meta.dirname, '../../..');

const SERVER_NAMES = [
  'flutter-ultra-build',
  'flutter-ultra-runtime',
  'flutter-ultra-gesture',
  'flutter-ultra-browser',
  'flutter-ultra-native-mobile',
  'flutter-ultra-native-desktop',
  'flutter-ultra-devtools',
  'flutter-ultra-patrol',
] as const;

function binPath(root: string, server: string): string {
  return join(root, 'packages', server, 'dist', 'bin.cjs');
}

describe('bundled server startup (direct + symlinked spawn)', () => {
  let linkParent: string;
  let linkedRoot: string;
  let client: McpClient | undefined;

  beforeAll(() => {
    for (const server of SERVER_NAMES) {
      if (!existsSync(binPath(ROOT, server))) {
        throw new Error(
          `${binPath(ROOT, server)} missing — run \`npm run build && node scripts/bundle.mjs\` first`,
        );
      }
    }
    linkParent = mkdtempSync(join(tmpdir(), 'flutter-ultra-link-'));
    linkedRoot = join(linkParent, 'linked-repo');
    // 'junction' needs no admin rights on Windows; the type hint is ignored on POSIX.
    symlinkSync(ROOT, linkedRoot, 'junction');
  });

  afterAll(() => {
    rmSync(linkParent, { recursive: true, force: true });
  });

  afterEach(() => {
    client?.close();
    client = undefined;
  });

  for (const server of SERVER_NAMES) {
    it(`${server} answers initialize from its direct path`, { timeout: 30_000 }, async () => {
      client = spawnMcpClient(binPath(ROOT, server), ROOT);
      const result = await client.initialize();
      expect(result.serverInfo?.name).toBe(server);
    });

    it(
      `${server} answers initialize when spawned through a symlink/junction`,
      { timeout: 30_000 },
      async () => {
        client = spawnMcpClient(binPath(linkedRoot, server), ROOT);
        const result = await client.initialize();
        expect(result.serverInfo?.name).toBe(server);
      },
    );
  }
});
