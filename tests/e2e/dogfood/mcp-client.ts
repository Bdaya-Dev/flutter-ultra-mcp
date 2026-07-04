// Minimal line-framed JSON-RPC client for spawning a bundled MCP server as a
// real child process. E2E tests use this instead of importing createServer()
// in-process, because process-level regressions (main-module guards, spawn
// semantics, module resolution) are invisible to in-process tests.

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpClient {
  proc: ChildProcess;
  initialize(): Promise<{ serverInfo?: { name?: string } }>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  stderr(): string;
  close(): void;
}

export function spawnMcpClient(bin: string, repoRoot: string): McpClient {
  const proc = spawn('node', [bin], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FLUTTER_ULTRA_STATE_DIR: '',
      NODE_PATH: join(repoRoot, 'node_modules'),
    },
  });

  const stderrChunks: string[] = [];
  proc.stderr?.on('data', (c: Buffer) => stderrChunks.push(c.toString()));

  let nextId = 1;
  const pending = new Map<number, { resolve: (msg: JsonRpcMessage) => void }>();

  // Single spawn-error listener for the client — one per request trips
  // MaxListenersExceededWarning under poll loops.
  let spawnError: Error | undefined;
  proc.once('error', (err) => {
    spawnError = err;
  });

  let buffer = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as JsonRpcMessage;
        if (parsed.id !== undefined && pending.has(parsed.id)) {
          pending.get(parsed.id)!.resolve(parsed);
          pending.delete(parsed.id);
        }
      } catch {
        // non-JSON — skip
      }
    }
  });

  function request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcMessage> {
    const id = nextId++;
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      if (spawnError) {
        reject(spawnError);
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout on ${method}. stderr: [${stderrChunks.join('')}]`));
      }, timeoutMs);
      const onExit = (code: number | null): void => {
        clearTimeout(timer);
        pending.delete(id);
        reject(
          spawnError ??
            new Error(
              `Server exited (code ${code}) before answering ${method} — a silent exit here ` +
                `is the symlinked-main-module regression. stderr: [${stderrChunks.join('')}]`,
            ),
        );
      };
      proc.once('exit', onExit);
      pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          proc.removeListener('exit', onExit);
          resolve(msg);
        },
      });
      proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  return {
    proc,
    async initialize() {
      const msg = await request(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'dogfood-e2e', version: '0.0.0' },
        },
        15_000,
      );
      if (msg.error) throw new Error(`initialize failed: ${msg.error.message}`);
      proc.stdin!.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
      );
      return msg.result as { serverInfo?: { name?: string } };
    },
    async callTool(name, args) {
      const msg = await request('tools/call', { name, arguments: args }, 60_000);
      if (msg.error) throw new Error(`tools/call ${name} failed: ${msg.error.message}`);
      const result = msg.result as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
      };
      const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
      if (result.isError) throw new Error(`Tool ${name} errored: ${text}`);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    },
    stderr: () => stderrChunks.join(''),
    close() {
      proc.stdin?.end();
      proc.kill('SIGTERM');
    },
  };
}
