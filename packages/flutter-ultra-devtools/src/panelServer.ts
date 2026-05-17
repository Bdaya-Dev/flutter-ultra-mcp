// WebSocket server for DevTools panel connections.
//
// The DevTools extension iframe connects outbound to this WS server.
// Multiple panels (viewers) can connect simultaneously.

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { Logger } from '@flutter-ultra/mcp-runtime';
import type { PanelEvent } from './eventBus.js';

export interface PanelStatus {
  running: boolean;
  port: number | null;
  viewers: number;
  url: string | null;
}

export interface PanelCommand {
  type: string;
  payload: Record<string, unknown>;
  viewerId: string;
  timestamp: string;
}

interface Viewer {
  id: string;
  ws: WebSocket;
  connectedAt: string;
}

export class PanelServer {
  private wss: WebSocketServer | null = null;
  private port: number | null = null;
  private viewers: Map<string, Viewer> = new Map();
  private commandWaiters: Array<{
    resolve: (cmd: PanelCommand) => void;
    reject: (err: Error) => void;
  }> = [];
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'panel-server' });
  }

  async start(port: number): Promise<string> {
    if (this.wss) {
      if (this.port === port) {
        return `ws://127.0.0.1:${port}`;
      }
      await this.stop();
    }

    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port, host: '127.0.0.1' });

      wss.on('listening', () => {
        this.wss = wss;
        this.port = port;
        this.logger.info('panel server listening', { port });
        resolve(`ws://127.0.0.1:${port}`);
      });

      wss.on('error', (err) => {
        this.logger.error('panel server error', { err: err.message });
        reject(err);
      });

      wss.on('connection', (ws) => {
        const viewer: Viewer = {
          id: randomUUID(),
          ws,
          connectedAt: new Date().toISOString(),
        };
        this.viewers.set(viewer.id, viewer);
        this.logger.info('panel viewer connected', { viewerId: viewer.id });

        ws.send(
          JSON.stringify({
            type: 'welcome',
            viewerId: viewer.id,
            serverTime: new Date().toISOString(),
          }),
        );

        ws.on('message', (data) => {
          this.handleViewerMessage(viewer, data);
        });

        ws.on('close', () => {
          this.viewers.delete(viewer.id);
          this.logger.info('panel viewer disconnected', { viewerId: viewer.id });
        });

        ws.on('error', (err) => {
          this.logger.warn('viewer ws error', { viewerId: viewer.id, err: err.message });
          this.viewers.delete(viewer.id);
        });
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.wss) return;

    for (const viewer of this.viewers.values()) {
      viewer.ws.close(1001, 'server shutting down');
    }
    this.viewers.clear();

    for (const waiter of this.commandWaiters) {
      waiter.reject(new Error('Panel server stopped while waiting for command'));
    }
    this.commandWaiters = [];

    return new Promise((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
        this.port = null;
        this.logger.info('panel server stopped');
        resolve();
      });
    });
  }

  getStatus(): PanelStatus {
    return {
      running: this.wss !== null,
      port: this.port,
      viewers: this.viewers.size,
      url: this.port ? `ws://127.0.0.1:${this.port}` : null,
    };
  }

  broadcast(event: PanelEvent): number {
    if (this.viewers.size === 0) return 0;

    const payload = JSON.stringify(event);
    let delivered = 0;

    for (const viewer of this.viewers.values()) {
      if (viewer.ws.readyState === WebSocket.OPEN) {
        viewer.ws.send(payload);
        delivered++;
      }
    }

    return delivered;
  }

  async waitForCommand(timeoutMs: number, signal?: AbortSignal): Promise<PanelCommand> {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.commandWaiters.push(waiter);

      const timer = setTimeout(() => {
        const idx = this.commandWaiters.indexOf(waiter);
        if (idx !== -1) this.commandWaiters.splice(idx, 1);
        reject(new Error(`No panel command received within ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this.commandWaiters.indexOf(waiter);
        if (idx !== -1) this.commandWaiters.splice(idx, 1);
      };

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            cleanup();
            reject(new Error('Cancelled while waiting for panel command'));
          },
          { once: true },
        );
      }

      const origResolve = waiter.resolve;
      waiter.resolve = (cmd) => {
        clearTimeout(timer);
        origResolve(cmd);
      };
    });
  }

  private handleViewerMessage(viewer: Viewer, data: unknown): void {
    try {
      const str = typeof data === 'string' ? data : (data as Buffer).toString('utf-8');
      const msg = JSON.parse(str) as { type?: string; payload?: Record<string, unknown> };

      if (msg.type === 'command' && this.commandWaiters.length > 0) {
        const cmd: PanelCommand = {
          type: msg.payload?.['command'] as string ?? 'unknown',
          payload: msg.payload ?? {},
          viewerId: viewer.id,
          timestamp: new Date().toISOString(),
        };
        const waiter = this.commandWaiters.shift()!;
        waiter.resolve(cmd);
      }
    } catch {
      this.logger.warn('invalid message from viewer', { viewerId: viewer.id });
    }
  }
}
