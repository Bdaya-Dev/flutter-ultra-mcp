// Dogfood smoke test: runtime MCP server starts cleanly and lists tools.
//
// Does NOT require a running Flutter app. Validates that:
//   1. The server process starts without crashing.
//   2. It responds to MCP initialize + tools/list over stdio.
//
// The MCP SDK v1.29 StdioServerTransport uses newline-delimited JSON
// (serializeMessage = JSON.stringify + '\n'). We use the same framing.

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const RUNTIME_BIN = resolve(
  import.meta.dirname,
  '../../../packages/flutter-ultra-runtime/dist/bin.cjs',
);

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function sendRequest(proc: ChildProcess, id: number, method: string, params: object = {}): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  proc.stdin!.write(msg + '\n');
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
          // Only collect responses (have numeric id), not notifications
          if (parsed.id !== undefined) {
            results.push(parsed);
            if (results.length >= count) {
              clearTimeout(timer);
              resolve(results);
            }
          }
        } catch {
          // non-JSON or notification — skip
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('Dogfood: runtime MCP server smoke test', () => {
  let proc: ChildProcess;

  afterAll(() => {
    proc?.stdin?.end();
    proc?.kill('SIGTERM');
  });

  it('server starts without crashing', async () => {
    proc = spawn('node', [RUNTIME_BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FLUTTER_ULTRA_STATE_DIR: '' },
    });

    const stderrLines: string[] = [];
    proc.stderr?.on('data', (c: Buffer) => stderrLines.push(c.toString()));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2000);
      proc.once('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0 && code !== null) {
          reject(new Error(`Server exited with code ${code}. stderr: ${stderrLines.join('')}`));
        } else {
          resolve();
        }
      });
    });

    expect(proc.exitCode).toBeNull();
  }, 10_000);

  it('responds to MCP initialize', async () => {
    const responsePromise = collectResponses(proc, 1, 10_000);
    sendRequest(proc, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dogfood-test', version: '0.0.0' },
    });

    const [initResp] = await responsePromise;
    expect(initResp!.id).toBe(1);
    expect(initResp!.error).toBeUndefined();
    const result = initResp!.result as { serverInfo?: { name?: string } };
    expect(result.serverInfo?.name).toBeTruthy();
  }, 15_000);

  it('lists tools including core runtime tools', async () => {
    // Send initialized notification first (required by MCP protocol)
    proc.stdin!.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n',
    );

    const responsePromise = collectResponses(proc, 1, 10_000);
    sendRequest(proc, 2, 'tools/list', {});

    const [listResp] = await responsePromise;
    expect(listResp!.id).toBe(2);
    expect(listResp!.error).toBeUndefined();

    const tools = (listResp!.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name);

    expect(names).toContain('list_sessions');
    expect(names).toContain('launch_app');
    expect(names).toContain('hot_reload');
    expect(names.length).toBeGreaterThan(5);
  }, 15_000);

  it('returns a result (not crash) for tool call with no session', async () => {
    const responsePromise = collectResponses(proc, 1, 10_000);
    sendRequest(proc, 3, 'tools/call', {
      name: 'hot_reload',
      arguments: { sessionId: 'nonexistent' },
    });

    const [callResp] = await responsePromise;
    expect(callResp!.id).toBe(3);
    // Server must return a result (possibly isError:true) — NOT an unhandled crash
    expect(proc.exitCode).toBeNull();
  }, 15_000);
});
