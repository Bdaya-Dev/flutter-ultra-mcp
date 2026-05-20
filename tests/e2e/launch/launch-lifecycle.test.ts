// E2E integration test: launch_app → poll → attach → screenshot → stop
//
// This test exercises the REAL flutter run --machine lifecycle that our
// unit tests never cover. It catches bugs like the Chrome CDP port
// mismatch (d3859a4) where pre-allocating --remote-debugging-port
// conflicted with Flutter's ChromiumLauncher.
//
// Runs only in CI (process.env.CI) where Flutter SDK and Chrome are available.
// Tests both web-server mode (fast, no DWDS) and chrome mode (DWDS + VM Service).

import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const SERVER_BIN = resolve(
  import.meta.dirname,
  '../../../packages/flutter-ultra-runtime/dist/bin.cjs',
);

const COUNTER_APP_DIR = resolve(import.meta.dirname, '../../../examples/counter-app');

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
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

function waitForResponse(
  proc: ReturnType<typeof spawn>,
  targetId: number,
  timeoutMs: number,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for response id=${targetId} after ${timeoutMs}ms`)),
      timeoutMs,
    );

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse;
          if (parsed.id === targetId) {
            clearTimeout(timer);
            proc.stdout!.removeListener('data', onData);
            resolve(parsed);
          }
        } catch {
          // non-JSON — ignore
        }
      }
    };

    proc.stdout!.on('data', onData);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function callTool(
  proc: ReturnType<typeof spawn>,
  id: number,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  sendRequest(proc, id, 'tools/call', { name: toolName, arguments: args });
  return waitForResponse(proc, id, timeoutMs).then((resp) => {
    if (resp.error) {
      throw new Error(`Tool ${toolName} RPC error: ${resp.error.message}`);
    }
    const result = resp.result as McpToolResult;
    if (result.isError) {
      const text = result.content?.[0]?.text ?? 'unknown error';
      throw new Error(`Tool ${toolName} returned error: ${text}`);
    }
    const text = result.content?.[0]?.text;
    if (text) {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { raw: text };
      }
    }
    return result as unknown as Record<string, unknown>;
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('E2E: launch_app lifecycle', () => {
  let proc: ReturnType<typeof spawn> | null = null;

  afterAll(async () => {
    if (proc) {
      proc.stdin!.end();
      proc.kill('SIGTERM');
      await sleep(1_000);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }
  });

  it.skipIf(!process.env.CI)(
    'web-server mode: launch → poll(attached) → webServerUrl populated → stop',
    async () => {
      proc = spawn('node', [SERVER_BIN], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LOG_LEVEL: 'warn' },
      });
      proc.stderr!.on('data', () => {});

      // Initialize MCP session
      const initResp = await waitForResponse(proc, 1, 10_000);
      sendRequest(proc, 1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-launch-test', version: '0.0.0' },
      });
      await waitForResponse(proc, 1, 10_000);

      // Launch in web-server mode (fast, no DWDS)
      const launchResult = await callTool(proc, 10, 'launch_app', {
        projectDir: COUNTER_APP_DIR,
        target: 'lib/main.dart',
        device: 'chrome',
        webLaunchMode: 'web-server',
        webPort: 9753,
      }, 30_000);

      const jobId = launchResult['jobId'] as string;
      expect(jobId).toBeTruthy();
      expect(launchResult['webLaunchMode']).toBe('web-server');

      // Poll until attached (web-server should attach quickly — no DWDS wait)
      let stage = '';
      let webServerUrl = '';
      for (let i = 0; i < 60; i++) {
        await sleep(2_000);
        const pollResult = await callTool(proc, 20 + i, 'poll_launch_app', {
          jobId,
        }, 10_000);

        const job = pollResult['job'] as Record<string, unknown>;
        stage = job['stage'] as string;

        if (stage === 'attached') {
          webServerUrl = (job['webServerUrl'] as string) ?? '';
          break;
        }
        if (stage === 'failed') {
          const errorMsg = (job['errorMessage'] as string) ?? 'unknown';
          throw new Error(`launch_app failed: ${errorMsg}`);
        }
      }

      expect(stage).toBe('attached');
      expect(webServerUrl).toContain('localhost');

      // Stop the app
      const stopResult = await callTool(proc, 90, 'stop_app', {
        jobId,
        force: true,
      }, 15_000);

      const finalJob = stopResult['job'] as Record<string, unknown>;
      expect(finalJob['stage']).toBe('stopped');

      // Clean up
      proc.stdin!.end();
      proc.kill('SIGTERM');
      proc = null;
    },
    180_000,
  );

  it.skipIf(!process.env.CI)(
    'chrome mode: launch → poll(attached) → chromeCdpPort discovered → stop',
    async () => {
      proc = spawn('node', [SERVER_BIN], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LOG_LEVEL: 'warn' },
      });
      proc.stderr!.on('data', () => {});

      sendRequest(proc, 1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-launch-test', version: '0.0.0' },
      });
      await waitForResponse(proc, 1, 10_000);

      // Launch in chrome mode (headless + DWDS)
      const launchResult = await callTool(proc, 10, 'launch_app', {
        projectDir: COUNTER_APP_DIR,
        target: 'lib/main.dart',
        device: 'chrome',
      }, 30_000);

      const jobId = launchResult['jobId'] as string;
      expect(jobId).toBeTruthy();

      // Poll until attached — chrome mode takes longer (DWDS connection)
      let stage = '';
      let chromeCdpPort: number | undefined;
      let sessionId: string | undefined;
      for (let i = 0; i < 60; i++) {
        await sleep(3_000);
        const pollResult = await callTool(proc, 20 + i, 'poll_launch_app', {
          jobId,
        }, 10_000);

        const job = pollResult['job'] as Record<string, unknown>;
        stage = job['stage'] as string;

        if (stage === 'attached') {
          chromeCdpPort = job['chromeCdpPort'] as number | undefined;
          sessionId = job['sessionId'] as string | undefined;
          break;
        }
        if (stage === 'failed') {
          const errorMsg = (job['errorMessage'] as string) ?? 'unknown';
          throw new Error(`launch_app failed: ${errorMsg}`);
        }
      }

      expect(stage).toBe('attached');
      // CDP port should be discovered from Chrome's process after launch
      expect(chromeCdpPort).toBeTypeOf('number');
      expect(chromeCdpPort).toBeGreaterThan(0);
      // VM Service session should be created via DWDS
      expect(sessionId).toBeTruthy();

      // Stop the app
      const stopResult = await callTool(proc, 90, 'stop_app', {
        jobId,
        force: true,
      }, 15_000);

      const finalJob = stopResult['job'] as Record<string, unknown>;
      expect(finalJob['stage']).toBe('stopped');

      proc.stdin!.end();
      proc.kill('SIGTERM');
      proc = null;
    },
    300_000,
  );
});
