// Minimal JSON-RPC 2.0 client over a Device RpcStream.
//
// Frames each request/response as one newline-delimited JSON object on
// stdin/stdout. Pending requests are keyed by `id` and resolved when the
// matching response arrives.
//
// Shape (request):   {"jsonrpc":"2.0","id":1,"method":"listWindows","params":{...}}
// Shape (response):  {"jsonrpc":"2.0","id":1,"result":{...}}  // success
//                  | {"jsonrpc":"2.0","id":1,"error":{code,message,data?}}  // failure
//
// Notifications (server → client, no id) are surfaced via the optional
// onNotification callback for log lines and progress.

import { setTimeout as setNodeTimeout } from 'node:timers';
import type { RpcStream } from '../device/types.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponseSuccess<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result: T;
}

export interface JsonRpcResponseError {
  jsonrpc: '2.0';
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse<T = unknown> = JsonRpcResponseSuccess<T> | JsonRpcResponseError;

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

export interface JsonRpcClientOptions {
  defaultTimeoutMs?: number;
  onNotification?: (notification: JsonRpcNotification) => void;
  onStderr?: (line: string) => void;
}

/**
 * JsonRpcClient — speaks JSON-RPC 2.0 over a `RpcStream` (stdin/stdout).
 * Single-threaded request queue; responses are matched by integer id.
 */
export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setNodeTimeout>;
    }
  >();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private closed = false;
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly stream: RpcStream,
    private readonly opts: JsonRpcClientOptions = {},
  ) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
    this.wireStdout();
    this.wireStderr();
    void this.wireExit();
  }

  private wireStdout(): void {
    this.stream.stdout.setEncoding('utf8');
    this.stream.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.drainStdout();
    });
  }

  private wireStderr(): void {
    this.stream.stderr.setEncoding('utf8');
    this.stream.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk;
      let nl = this.stderrBuffer.indexOf('\n');
      while (nl !== -1) {
        const line = this.stderrBuffer.slice(0, nl).replace(/\r$/, '');
        this.stderrBuffer = this.stderrBuffer.slice(nl + 1);
        if (line.length > 0) this.opts.onStderr?.(line);
        nl = this.stderrBuffer.indexOf('\n');
      }
    });
  }

  private async wireExit(): Promise<void> {
    const code = await this.stream.exit;
    this.closed = true;
    // Reject all pending with a clear error so callers don't hang.
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`Sidecar exited (code=${code ?? 'null'}) before responding.`));
    }
    this.pending.clear();
  }

  private drainStdout(): void {
    let nl = this.stdoutBuffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.stdoutBuffer.slice(0, nl).replace(/\r$/, '').trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (line.length > 0) this.handleFrame(line);
      nl = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleFrame(line: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch (err) {
      // Sidecar wrote garbage — bubble to stderr handler so operator sees it.
      this.opts.onStderr?.(`[rpc] non-JSON frame: ${(err as Error).message}: ${line}`);
      return;
    }
    if (!isObject(frame)) return;
    if ('id' in frame && (frame as { id?: unknown }).id !== null) {
      this.handleResponse(frame as unknown as JsonRpcResponse);
      return;
    }
    if ('method' in frame) {
      this.opts.onNotification?.(frame as unknown as JsonRpcNotification);
    }
  }

  private handleResponse(resp: JsonRpcResponse): void {
    const idRaw = (resp as { id?: unknown }).id;
    if (typeof idRaw !== 'number') return;
    const pending = this.pending.get(idRaw);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(idRaw);
    if ('error' in resp && resp.error) {
      pending.reject(new JsonRpcError(resp.error.code, resp.error.message, resp.error.data));
      return;
    }
    pending.resolve((resp as JsonRpcResponseSuccess).result);
  }

  /**
   * Send a request and await its response.
   * Throws JsonRpcError on remote error, Error on timeout/transport.
   */
  async call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) throw new Error('JsonRpcClient is closed.');
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method };
    if (params !== undefined) req.params = params;
    const payload = JSON.stringify(req) + '\n';

    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setNodeTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`JSON-RPC call '${method}' (id=${id}) timed out after ${effectiveTimeout}ms`),
        );
      }, effectiveTimeout);
      timer.unref?.();
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      const ok = this.stream.stdin.write(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
      if (!ok) {
        // Backpressure — stdin is full. Wait for drain to avoid losing the
        // write; if drain never fires the call still times out.
        this.stream.stdin.once('drain', () => {
          /* drained */
        });
      }
    });
  }

  /** Fire-and-forget notification (no id, no response expected). */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const note: JsonRpcNotification = { jsonrpc: '2.0', method };
    if (params !== undefined) note.params = params;
    this.stream.stdin.write(JSON.stringify(note) + '\n');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.stream.stdin.end();
    } catch {
      // ignore
    }
    await this.stream.kill('SIGTERM');
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
