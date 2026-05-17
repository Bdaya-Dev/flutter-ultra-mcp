// WebSocket JSON-RPC 2.0 transport for the Dart VM service / DDS.
//
// Responsibilities:
// - Accept either a full ws:// URI or a {host, port, ws_path} triple
// - Send JSON-RPC 2.0 requests with monotonically-increasing IDs
// - Correlate responses to pending requests via id->{resolve, reject}
// - Surface notifications (event frames) to the client layer
// - Reject all pending requests on disconnect with ConnectionDisposedError
// - Optional exponential-backoff auto-reconnect per AC-R2 (0.5/1/2/4/8/14.5s)

import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import {
  ConnectionDisposedError,
  ConnectionTimeoutError,
  RpcError,
  type RpcErrorPayload,
} from './errors.js';
import {
  JsonRpcNotificationSchema,
  JsonRpcResponseSchema,
  type JsonRpcNotification,
  type JsonValue,
} from './types.js';

export interface UriParts {
  host: string;
  port: number;
  ws_path: string;
}

export type ConnectTarget = string | UriParts;

export interface TransportOptions {
  autoReconnect?: boolean;
  reconnectDelaysMs?: number[];
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 14_500];
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  method: string;
  resolve(value: JsonValue): void;
  reject(error: Error): void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export type TransportEvents = {
  open: [];
  close: [code: number, reason: string];
  notification: [JsonRpcNotification];
  reconnecting: [attempt: number, delayMs: number];
  reconnected: [];
  protocolError: [Error];
};

export function buildWsUri(target: ConnectTarget): string {
  if (typeof target === 'string') {
    if (!/^wss?:\/\//.test(target)) {
      throw new Error(`Invalid WebSocket URI: must start with ws:// or wss://. Got: ${target}`);
    }
    return target;
  }
  const { host, port, ws_path } = target;
  const path = ws_path.startsWith('/') ? ws_path : `/${ws_path}`;
  return `ws://${host}:${port}${path}`;
}

export class VmServiceTransport extends EventEmitter<TransportEvents> {
  readonly uri: string;
  private socket: WebSocket | undefined;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private disposed = false;
  private autoReconnect: boolean;
  private reconnectDelaysMs: number[];
  private connectTimeoutMs: number;
  private requestTimeoutMs: number;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(target: ConnectTarget, options: TransportOptions = {}) {
    super();
    this.uri = buildWsUri(target);
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.disposed) throw new ConnectionDisposedError('Transport disposed');
    if (this.isOpen) return;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.uri);
      this.socket = ws;

      const timeout = setTimeout(() => {
        ws.terminate();
        reject(
          new ConnectionTimeoutError(
            `WS connect timed out after ${this.connectTimeoutMs}ms: ${this.uri}`,
          ),
        );
      }, this.connectTimeoutMs);

      ws.once('open', () => {
        clearTimeout(timeout);
        this.reconnectAttempt = 0;
        this.attachSocketListeners(ws);
        this.emit('open');
        resolve();
      });

      ws.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private attachSocketListeners(ws: WebSocket): void {
    ws.on('message', (data) => this.onMessage(data));
    ws.on('close', (code, reason) => this.onClose(code, reason.toString('utf-8')));
    ws.on('error', (err) => {
      // Surface protocol-level errors for observability. Pending requests
      // are rejected on the subsequent close event (ws library emits both).
      this.emit('protocolError', err);
    });
  }

  private onMessage(data: unknown): void {
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (Buffer.isBuffer(data)) {
      text = data.toString('utf-8');
    } else if (Array.isArray(data)) {
      text = Buffer.concat(data as Buffer[]).toString('utf-8');
    } else {
      this.emit('protocolError', new Error('Unexpected non-string WS frame'));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      this.emit(
        'protocolError',
        new Error(`Malformed JSON from VM service: ${(err as Error).message}`),
      );
      return;
    }

    // Try response first (has `id`), then notification (has `method`).
    const asResponse = JsonRpcResponseSchema.safeParse(parsed);
    if (asResponse.success && asResponse.data.id !== null && asResponse.data.id !== undefined) {
      const frame = asResponse.data;
      const id = typeof frame.id === 'string' ? Number(frame.id) : (frame.id as number);
      const pending = this.pending.get(id);
      if (!pending) {
        // Late response after timeout — ignore silently.
        return;
      }
      this.pending.delete(id);
      clearTimeout(pending.timeoutHandle);
      if (frame.error) {
        pending.reject(new RpcError(frame.error as RpcErrorPayload, pending.method));
      } else {
        pending.resolve((frame.result ?? null) as JsonValue);
      }
      return;
    }

    const asNotification = JsonRpcNotificationSchema.safeParse(parsed);
    if (asNotification.success) {
      this.emit('notification', asNotification.data);
      return;
    }

    this.emit(
      'protocolError',
      new Error(
        `Unrecognized JSON-RPC frame: ${asResponse.success ? '(id-less response)' : asResponse.error.message}`,
      ),
    );
  }

  private onClose(code: number, reason: string): void {
    this.failAllPending(
      new ConnectionDisposedError(`VM service WS closed (code=${code}, reason=${reason})`),
    );
    this.socket = undefined;
    this.emit('close', code, reason);

    if (!this.disposed && this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const idx = Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1);
    const delay =
      this.reconnectDelaysMs[idx] ??
      this.reconnectDelaysMs[this.reconnectDelaysMs.length - 1] ??
      14_500;
    this.reconnectAttempt += 1;
    this.emit('reconnecting', this.reconnectAttempt, delay);

    this.reconnectTimer = setTimeout(() => {
      if (this.disposed) return;
      this.connect().then(
        () => this.emit('reconnected'),
        () => this.scheduleReconnect(),
      );
    }, delay);
  }

  private failAllPending(err: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(err);
    }
    this.pending.clear();
  }

  request(method: string, params?: JsonValue): Promise<JsonValue> {
    if (this.disposed) return Promise.reject(new ConnectionDisposedError('Transport disposed'));
    if (!this.isOpen || !this.socket) {
      return Promise.reject(new ConnectionDisposedError('VM service WS not open'));
    }

    const id = this.nextRequestId++;
    const envelope: { jsonrpc: '2.0'; id: number; method: string; params?: JsonValue } = {
      jsonrpc: '2.0',
      id,
      method,
    };
    if (params !== undefined) envelope.params = params;

    return new Promise<JsonValue>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ConnectionTimeoutError(
            `RPC ${method} (id=${id}) timed out after ${this.requestTimeoutMs}ms`,
          ),
        );
      }, this.requestTimeoutMs);

      this.pending.set(id, { method, resolve, reject, timeoutHandle });

      try {
        this.socket!.send(JSON.stringify(envelope));
      } catch (err) {
        clearTimeout(timeoutHandle);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.failAllPending(new ConnectionDisposedError('Transport disposed'));
    if (this.socket) {
      const sock = this.socket;
      this.socket = undefined;
      await new Promise<void>((resolve) => {
        sock.once('close', () => resolve());
        try {
          sock.close();
        } catch {
          resolve();
        }
      });
    }
    this.removeAllListeners();
  }
}
