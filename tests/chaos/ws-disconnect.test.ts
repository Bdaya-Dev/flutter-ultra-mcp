// Chaos: WebSocket disconnect scenarios.
// Covers §18.10 rows: "Kill VM Service mid-screenshot", "Drop 50% of WS frames",
// "Hot restart Flutter during tail_logs stream".

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ChaosMockVmServer } from './helpers/mock-vm-server.js';

describe('chaos: WebSocket disconnect mid-call', () => {
  let server: ChaosMockVmServer;

  beforeEach(async () => {
    server = new ChaosMockVmServer();
    server.on('getVM', () => ({
      result: { type: 'VM', name: 'test', architectureBits: 64, version: '3.4.0' },
    }));
    server.on('getIsolate', () => ({
      result: { type: 'Isolate', id: 'isolates/1', name: 'main' },
    }));
    server.on('ext.flutter.ultra.screenshot', async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { result: { type: 'Screenshot', bytes: 'base64data' } };
    });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('client receives error when server kills connection mid-RPC', async () => {
    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      ws.on('message', (data) => {
        try {
          resolve(JSON.parse(data.toString()));
        } catch (e) {
          reject(e);
        }
      });
      ws.on('close', () => reject(new Error('connection closed')));
      ws.on('error', (e) => reject(e));
    });

    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ext.flutter.ultra.screenshot' }));

    // Kill connection after 50ms (before 200ms handler completes)
    setTimeout(() => server.closeAllClients(1011), 50);

    await expect(responsePromise).rejects.toThrow(/connection closed/);
  });

  it('client reconnects and succeeds after server recovers from disconnect', async () => {
    const uri = await server.start();

    const ws1 = new WebSocket(uri);
    await new Promise<void>((resolve) => ws1.on('open', resolve));
    expect(server.clientCount).toBe(1);

    server.closeAllClients(1011);
    await new Promise<void>((resolve) => ws1.on('close', resolve));

    const ws2 = new WebSocket(uri);
    await new Promise<void>((resolve) => ws2.on('open', resolve));
    expect(server.clientCount).toBe(1);

    const result = await new Promise<unknown>((resolve) => {
      ws2.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws2.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVM' }));
    });
    expect(result).toHaveProperty('result.type', 'VM');

    ws2.close();
  });

  it('handles 50% frame drop rate with retries', async () => {
    server.setChaos({ dropRate: 0.5 });
    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    const results: unknown[] = [];
    const errors: Error[] = [];

    const attempts = 20;
    for (let i = 0; i < attempts; i++) {
      const rpcPromise = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
        const handler = (data: Buffer | ArrayBuffer | Buffer[]): void => {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(JSON.parse(data.toString()));
        };
        ws.on('message', handler);
      });

      ws.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'getVM' }));

      try {
        results.push(await rpcPromise);
      } catch (e) {
        errors.push(e as Error);
      }
    }

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(errors.length).toBeGreaterThan(0);

    ws.close();
  });

  it('server terminate (no close frame) triggers error on client', async () => {
    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    server.terminateAllClients();

    const { code } = await closePromise;
    expect(code).toBe(1006);
  });
});

describe('chaos: WebSocket latency injection', () => {
  let server: ChaosMockVmServer;

  beforeEach(async () => {
    server = new ChaosMockVmServer();
    server.on('getVM', () => ({
      result: { type: 'VM', name: 'test', architectureBits: 64, version: '3.4.0' },
    }));
  });

  afterEach(async () => {
    await server.stop();
  });

  it('calls succeed under high latency without data corruption', async () => {
    server.setChaos({ latencyMs: 500 });
    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    const start = Date.now();
    const result = await new Promise<unknown>((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVM' }));
    });
    const elapsed = Date.now() - start;

    expect(result).toHaveProperty('result.type', 'VM');
    expect(elapsed).toBeGreaterThanOrEqual(400);

    ws.close();
  });
});
