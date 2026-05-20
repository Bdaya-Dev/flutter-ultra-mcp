// E2E test: playwright-core is available as a root dependency and the
// browser MCP server starts without needing a SessionStart install hook.
//
// Validates that after `npm ci`, playwright-core is resolvable from the
// monorepo root node_modules — no hook, no NODE_PATH override needed.

import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

const BROWSER_BIN = resolve(ROOT, 'packages/flutter-ultra-browser/dist/bin.cjs');

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

describe('playwright-core as root dependency', () => {
  it('playwright-core exists in root node_modules', () => {
    const pwPath = join(ROOT, 'node_modules', 'playwright-core');
    expect(existsSync(pwPath)).toBe(true);
  });

  it('playwright-core is resolvable from browser server bin', () => {
    expect(() => require.resolve('playwright-core', { paths: [ROOT] })).not.toThrow();
  });

  it('browser server starts WITHOUT NODE_PATH override', async () => {
    const proc = spawn('node', [BROWSER_BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FLUTTER_ULTRA_STATE_DIR: '',
        // Explicitly do NOT set NODE_PATH — playwright-core must resolve
        // from the normal node_modules hierarchy
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
            clientInfo: { name: 'pw-dep-test', version: '0.0.0' },
          },
        }) + '\n',
      );

      const [initResp] = await collectResponses(proc, 1, 15_000);
      expect(initResp!.id).toBe(1);
      expect(initResp!.error).toBeUndefined();

      await new Promise((r) => setTimeout(r, 500));

      proc.stdin!.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 500));

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

      const result = listResp!.result as { tools?: Array<{ name: string }> } | undefined;
      const tools = result?.tools;
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      const names = tools!.map((t) => t.name);
      expect(names).toContain('launch_browser');
      expect(names).toContain('screenshot');
      expect(names).toContain('connect_over_cdp');
    } finally {
      proc.stdin?.end();
      proc.kill('SIGTERM');
    }
  }, 30_000);
});
