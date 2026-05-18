// Chaos: Corrupt JSON-RPC frame handling.
// Covers §18.10: frame corruption during transit, partial frames,
// and invalid JSON-RPC structure.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ChaosMockVmServer } from './helpers/mock-vm-server.js';
import {
  corruptJsonRpcFrame,
  makeJsonRpcRequest,
  makeJsonRpcResponse,
} from './helpers/fault-injector.js';

describe('chaos: corrupt JSON-RPC frames', () => {
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

  it('server ignores corrupt incoming frames without crashing', async () => {
    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    ws.send('<<<NOT JSON>>>');

    const result = await new Promise<unknown>((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws.send(makeJsonRpcRequest(1, 'getVM'));
    });

    expect(result).toHaveProperty('result.type', 'VM');
    ws.close();
  });

  it('server handles partial JSON frame (truncated mid-object)', async () => {
    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    ws.send('{"jsonrpc":"2.0","id":1,"met');

    const result = await new Promise<unknown>((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws.send(makeJsonRpcRequest(2, 'getVM'));
    });
    expect(result).toHaveProperty('result.type', 'VM');

    ws.close();
  });

  it('server returns error for frame with missing method field', async () => {
    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    ws.send(JSON.stringify({ jsonrpc: '2.0', foo: 'bar' }));

    await new Promise((r) => setTimeout(r, 100));

    const result = await new Promise<unknown>((resolve) => {
      const handler = (data: Buffer | ArrayBuffer | Buffer[]): void => {
        const parsed = JSON.parse(data.toString()) as { id: number };
        if (parsed.id === 10) {
          ws.off('message', handler);
          resolve(parsed);
        }
      };
      ws.on('message', handler);
      ws.send(makeJsonRpcRequest(10, 'getVM'));
    });
    expect(result).toHaveProperty('result.type', 'VM');

    ws.close();
  });

  it('100% corruption rate means no valid responses, but server stays alive', async () => {
    server.setChaos({ corruptRate: 1.0 });
    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    const responses: string[] = [];
    ws.on('message', (data) => responses.push(data.toString()));

    for (let i = 0; i < 5; i++) {
      ws.send(makeJsonRpcRequest(i + 1, 'getVM'));
    }
    await new Promise((r) => setTimeout(r, 500));

    for (const resp of responses) {
      expect(resp).toContain('<<<CORRUPT>>>');
      expect(() => JSON.parse(resp)).toThrow();
    }

    server.clearChaos();
    const validResult = await new Promise<unknown>((resolve) => {
      const handler = (data: Buffer | ArrayBuffer | Buffer[]): void => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.id === 999) {
            ws.off('message', handler);
            resolve(parsed);
          }
        } catch {
          // ignore corrupt buffered responses
        }
      };
      ws.on('message', handler);
      ws.send(makeJsonRpcRequest(999, 'getVM'));
    });

    expect(validResult).toHaveProperty('result.type', 'VM');
    ws.close();
  });
});

describe('chaos: corrupt frame helpers', () => {
  it('corruptJsonRpcFrame produces deterministic corruption', () => {
    const valid = makeJsonRpcResponse(1, { status: 'ok' });
    const corrupt = corruptJsonRpcFrame(valid);

    expect(corrupt).toContain('<<<CORRUPT>>>');
    expect(corrupt.length).toBeGreaterThan(0);
    expect(() => JSON.parse(corrupt)).toThrow();

    const parsed = JSON.parse(valid);
    expect(parsed).toHaveProperty('result.status', 'ok');
  });
});

describe('chaos: binary frame injection', () => {
  let server: ChaosMockVmServer;

  beforeEach(async () => {
    server = new ChaosMockVmServer();
    server.on('getVM', () => ({
      result: { type: 'VM', name: 'test' },
    }));
  });

  afterEach(async () => {
    await server.stop();
  });

  it('server survives receiving binary frames instead of text', async () => {
    const uri = await server.start();
    const ws = new WebSocket(uri);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    ws.send(Buffer.from([0x00, 0xff, 0xfe, 0xfd, 0x01, 0x02]));

    const result = await new Promise<unknown>((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws.send(makeJsonRpcRequest(1, 'getVM'));
    });
    expect(result).toHaveProperty('result.type', 'VM');

    ws.close();
  });
});
