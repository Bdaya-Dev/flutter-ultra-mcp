// Mock VM service WS server for unit tests.
//
// Spawns an actual `ws` server on an ephemeral port so we exercise the real
// JSON-RPC framing + WebSocket lifecycle the client will face in production.
// Tests register typed handlers; the server replies with the recorded shape.

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

export class MockVmServer {
  private httpServer: Server | undefined;
  private wss: WebSocketServer | undefined;
  private handlers = new Map<string, MockHandler>();
  private clients = new Set<WebSocket>();
  port = 0;

  on(method: string, handler: MockHandler): this {
    this.handlers.set(method, handler);
    return this;
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
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, ...reply }));
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

  // Push a server-initiated notification (streamNotify event etc.) to all
  // connected clients. Used to test event subscriptions.
  broadcast(method: string, params: unknown): void {
    const frame = JSON.stringify({ jsonrpc: '2.0', method, params });
    for (const ws of this.clients) {
      ws.send(frame);
    }
  }

  // Force-close all client connections (simulates DDS hard disconnect).
  // Default 1011 = "server encountered unexpected condition" (valid per RFC 6455).
  // 1006 is reserved and rejected by ws.
  closeAllClients(code = 1011): void {
    for (const ws of this.clients) {
      ws.close(code);
    }
    this.clients.clear();
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
