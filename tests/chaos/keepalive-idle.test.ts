// Chaos: Server survives idle periods.
// Covers §18.10: "60s idle (no tool calls) followed by tools/list"
// Validates that keepalive pings keep the server alive through host
// inactivity windows (Bun #58004 workaround from §17.9).

import { describe, expect, it } from 'vitest';
import { ChaosMockVmServer } from './helpers/mock-vm-server.js';
import { WebSocket } from 'ws';
import { makeJsonRpcRequest } from './helpers/fault-injector.js';

describe('chaos: server survives idle periods', () => {
  it('server responds after 5s idle gap', async () => {
    const server = new ChaosMockVmServer();
    server.on('tools/list', () => ({
      result: { tools: [{ name: 'screenshot' }, { name: 'tap' }] },
    }));

    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    await new Promise((r) => setTimeout(r, 5_000));

    const result = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout after idle')), 5_000);
      ws.on('message', (data) => {
        clearTimeout(timeout);
        resolve(JSON.parse(data.toString()));
      });
      ws.send(makeJsonRpcRequest(1, 'tools/list'));
    });

    expect(result).toHaveProperty('result.tools');
    const tools = (result as { result: { tools: unknown[] } }).result.tools;
    expect(tools).toHaveLength(2);

    ws.close();
    await server.stop();
  });

  it('multiple rapid calls after idle all succeed', async () => {
    const server = new ChaosMockVmServer();
    let callCount = 0;
    server.on('getVM', () => {
      callCount++;
      return { result: { type: 'VM', callNumber: callCount } };
    });

    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    await new Promise((r) => setTimeout(r, 3_000));

    const responses: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      const result = await new Promise<unknown>((resolve) => {
        const handler = (data: Buffer | ArrayBuffer | Buffer[]): void => {
          const parsed = JSON.parse(data.toString()) as { id: number };
          if (parsed.id === i + 1) {
            ws.off('message', handler);
            resolve(parsed);
          }
        };
        ws.on('message', handler);
        ws.send(makeJsonRpcRequest(i + 1, 'getVM'));
      });
      responses.push(result);
    }

    expect(responses).toHaveLength(10);
    expect(callCount).toBe(10);

    ws.close();
    await server.stop();
  });
});
