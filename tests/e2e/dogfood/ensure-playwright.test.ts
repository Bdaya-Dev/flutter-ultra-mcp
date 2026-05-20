// E2E test: ensure-playwright.js correctly installs playwright-core
// and the browser MCP server can start with NODE_PATH pointing to it.
//
// Validates the full hook → install → server-start chain that runs on
// every Claude Code session. Uses a temp dir to avoid polluting the
// real CLAUDE_PLUGIN_DATA.

import { describe, it, expect, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ENSURE_SCRIPT = resolve(import.meta.dirname, '../../../scripts/ensure-playwright.js');

const BROWSER_BIN = resolve(
  import.meta.dirname,
  '../../../packages/flutter-ultra-browser/dist/bin.cjs',
);

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function collectResponses(
  proc: ChildProcess,
  count: number,
  timeoutMs: number,
): Promise<JsonRpcResponse[]> {
  return new Promise((resolve, reject) => {
    const results: JsonRpcResponse[] = [];
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${count} responses`)),
      timeoutMs,
    );

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse;
          if (parsed.id !== undefined) {
            results.push(parsed);
            if (results.length >= count) {
              clearTimeout(timer);
              resolve(results);
            }
          }
        } catch {
          // non-JSON — skip
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('ensure-playwright.js + browser server', () => {
  let tempDir: string;

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('installs playwright-core to a fresh temp directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'flutter-ultra-pw-test-'));

    expect(existsSync(join(tempDir, 'node_modules', 'playwright-core'))).toBe(false);

    execSync(`node "${ENSURE_SCRIPT}" "${tempDir}"`, {
      stdio: 'inherit',
      timeout: 60_000,
    });

    expect(existsSync(join(tempDir, 'node_modules', 'playwright-core'))).toBe(true);
  }, 90_000);

  it('is idempotent — second run is a no-op', () => {
    const before = existsSync(join(tempDir, 'node_modules', 'playwright-core'));
    expect(before).toBe(true);

    const start = Date.now();
    execSync(`node "${ENSURE_SCRIPT}" "${tempDir}"`, {
      stdio: 'inherit',
      timeout: 30_000,
    });
    const elapsed = Date.now() - start;

    expect(existsSync(join(tempDir, 'node_modules', 'playwright-core'))).toBe(true);
    // Second run should be fast (< 5s) since it's a require.resolve check
    expect(elapsed).toBeLessThan(5_000);
  }, 30_000);

  it('browser server starts with NODE_PATH pointing to installed playwright-core', async () => {
    const nmDir = join(tempDir, 'node_modules');
    const proc = spawn('node', [BROWSER_BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_PATH: nmDir,
        FLUTTER_ULTRA_STATE_DIR: join(tempDir, 'state'),
      },
    });

    proc.stderr?.on('data', () => {});

    try {
      proc.stdin!.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'pw-e2e-test', version: '0.0.0' },
          },
        }) + '\n',
      );

      const [initResp] = await collectResponses(proc, 1, 15_000);
      expect(initResp!.id).toBe(1);
      expect(initResp!.error).toBeUndefined();

      // Send initialized notification
      proc.stdin!.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        }) + '\n',
      );

      // List tools — should include browser tools that require playwright-core
      proc.stdin!.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }) + '\n',
      );

      const [listResp] = await collectResponses(proc, 1, 10_000);
      expect(listResp!.error).toBeUndefined();

      const tools = (listResp!.result as { tools: Array<{ name: string }> }).tools;
      const names = tools.map((t) => t.name);
      expect(names).toContain('launch_browser');
      expect(names).toContain('screenshot');
      expect(names).toContain('connect_over_cdp');
    } finally {
      proc.stdin?.end();
      proc.kill('SIGTERM');
    }
  }, 30_000);
});
