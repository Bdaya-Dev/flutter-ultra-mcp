// Re-exports the mock VM service server from vm-service-client with chaos
// extensions: latency injection, frame corruption, and mid-call disconnects.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export interface MockRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export type MockHandler = (
  params: unknown,
) =>
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } }
  | Promise<{ result: unknown } | { error: { code: number; message: string; data?: unknown } }>;

export interface ChaosConfig {
  dropRate?: number;
  latencyMs?: number;
  corruptRate?: number;
}

export class ChaosMockVmServer {
  private httpServer: Server | undefined;
  private wss: WebSocketServer | undefined;
  private handlers = new Map<string, MockHandler>();
  private clients = new Set<WebSocket>();
  private chaos: ChaosConfig = {};
  port = 0;

  on(method: string, handler: MockHandler): this {
    this.handlers.set(method, handler);
    return this;
  }

  setChaos(config: ChaosConfig): void {
    this.chaos = config;
  }

  clearChaos(): void {
    this.chaos = {};
  }

  async start(path = '/ws'): Promise<string> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer();
      this.wss = new WebSocketServer({ server: this.httpServer, path });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        ws.on('message', async (data) => {
          let req: MockRpcRequest;
          try {
            req = JSON.parse(data.toString()) as MockRpcRequest;
          } catch {
            return;
          }

          if (this.chaos.dropRate && Math.random() < this.chaos.dropRate) {
            return; // silently drop
          }

          if (this.chaos.latencyMs) {
            await new Promise((r) => setTimeout(r, this.chaos.latencyMs));
          }

          const handler = this.handlers.get(req.method);
          if (!handler) {
            ws.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: req.id,
                error: { code: -32601, message: `Method not found: ${req.method}` },
              }),
            );
            return;
          }

          const reply = await handler(req.params);
          let frame = JSON.stringify({ jsonrpc: '2.0', id: req.id, ...reply });

          if (this.chaos.corruptRate && Math.random() < this.chaos.corruptRate) {
            frame = frame.slice(0, Math.floor(frame.length / 2)) + '<<<CORRUPT>>>';
          }

          ws.send(frame);
        });
        ws.on('close', () => this.clients.delete(ws));
      });

      this.httpServer.once('error', reject);
      this.httpServer.listen(0, '127.0.0.1', () => {
        const addr = this.httpServer!.address() as AddressInfo;
        this.port = addr.port;
        resolve(`ws://127.0.0.1:${this.port}${path}`);
      });
    });
  }

  broadcast(method: string, params: unknown): void {
    const frame = JSON.stringify({ jsonrpc: '2.0', method, params });
    for (const ws of this.clients) {
      ws.send(frame);
    }
  }

  closeAllClients(code = 1011): void {
    for (const ws of this.clients) {
      ws.close(code);
    }
    this.clients.clear();
  }

  terminateAllClients(): void {
    for (const ws of this.clients) {
      ws.terminate();
    }
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  async stop(): Promise<void> {
    for (const ws of this.clients) {
      ws.terminate();
    }
    this.clients.clear();
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      this.httpServer?.close(() => resolve());
    });
  }
}
