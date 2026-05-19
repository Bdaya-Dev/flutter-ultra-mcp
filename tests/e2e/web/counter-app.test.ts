// E2E smoke test: flutter-ultra-browser MCP server × counter-app
//
// Runs only in CI (process.env.CI) where the counter-app is pre-built
// and served at localhost:8080 by the ci-e2e-web workflow.
//
// Protocol: spawn the browser MCP server binary, exchange JSON-RPC 2.0
// messages over stdio, assert the server responds correctly.

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const SERVER_BIN = resolve(
  import.meta.dirname,
  '../../../packages/flutter-ultra-browser/dist/bin.cjs',
);

// ─── helpers ────────────────────────────────────────────────────────────────

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function sendRequest(
  proc: ReturnType<typeof spawn>,
  id: number,
  method: string,
  params: unknown,
): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  proc.stdin!.write(msg + '\n');
}

function collectResponses(
  proc: ReturnType<typeof spawn>,
  count: number,
  timeoutMs: number,
): Promise<JsonRpcResponse[]> {
  return new Promise((resolve, reject) => {
    const responses: JsonRpcResponse[] = [];
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${count} responses`)),
      timeoutMs,
    );

    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse;
          if (parsed.id !== undefined) {
            responses.push(parsed);
            if (responses.length >= count) {
              clearTimeout(timer);
              resolve(responses);
            }
          }
        } catch {
          // non-JSON log line from the server — ignore
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('E2E: flutter-ultra-browser × counter-app', () => {
  it.skipIf(!process.env.CI)(
    'server starts, initializes, and lists browser tools',
    async () => {
      const proc = spawn('node', [SERVER_BIN], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LOG_LEVEL: 'warn' },
      });

      proc.stderr!.on('data', () => {});

      try {
        sendRequest(proc, 1, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e-test', version: '0.0.0' },
        });

        sendRequest(proc, 2, 'tools/list', {});

        const [initResp, listResp] = await collectResponses(proc, 2, 15_000);

        expect(initResp!.id).toBe(1);
        expect(initResp!.error).toBeUndefined();

        const tools = (listResp!.result as { tools: Array<{ name: string }> }).tools;
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toContain('launch_browser');
        expect(toolNames).toContain('navigate');
        expect(toolNames).toContain('screenshot');
        expect(toolNames).toContain('click');
        expect(toolNames).toContain('fill');
        expect(toolNames).toContain('connect_over_cdp');
        expect(tools.length).toBeGreaterThanOrEqual(20);
      } finally {
        proc.stdin!.end();
        proc.kill('SIGTERM');
      }
    },
    30_000,
  );
});
