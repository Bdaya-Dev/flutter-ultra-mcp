// Unit specs for CdpConsoleCapture — the structured CDP WebSocket capture
// that records Runtime.exceptionThrown, Runtime.consoleAPICalled (error/warning),
// and Log.entryAdded events from the browser DevTools Protocol.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import http from 'node:http';
import { CdpConsoleCapture } from '../../../src/runtime/cdp-console-capture.js';

// ---------------------------------------------------------------------------
// Mock CDP server — serves /json discovery and accepts WS connections
// ---------------------------------------------------------------------------

interface MockCdpServer {
  port: number;
  wss: WebSocketServer;
  httpServer: http.Server;
  connections: WsWebSocket[];
  close: () => Promise<void>;
  sendToAll: (data: unknown) => void;
}

function createMockCdpServer(): Promise<MockCdpServer> {
  return new Promise((resolve, reject) => {
    const connections: WsWebSocket[] = [];

    const httpServer = http.createServer((req, res) => {
      if (req.url === '/json') {
        const addr = httpServer.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              type: 'page',
              webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/1`,
            },
          ]),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      connections.push(ws);
      // Auto-ack enable commands
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as { id?: number; method?: string };
          if (msg.id != null) {
            ws.send(JSON.stringify({ id: msg.id, result: {} }));
          }
        } catch {
          /* ignore */
        }
      });
    });

    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        wss,
        httpServer,
        connections,
        close: () =>
          new Promise<void>((res) => {
            for (const c of connections) {
              try {
                c.close();
              } catch {
                /* */
              }
            }
            wss.close(() => {
              httpServer.close(() => res());
            });
          }),
        sendToAll: (data: unknown) => {
          const payload = JSON.stringify(data);
          for (const c of connections) {
            c.send(payload);
          }
        },
      });
    });

    httpServer.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CdpConsoleCapture', () => {
  let server: MockCdpServer;
  let capture: CdpConsoleCapture;

  beforeEach(async () => {
    server = await createMockCdpServer();
    capture = new CdpConsoleCapture();
  });

  afterEach(async () => {
    capture.disconnect();
    await server.close();
  });

  it('starts with empty errors', () => {
    expect(capture.capturedErrors).toEqual([]);
  });

  it('handleMessage parses Runtime.exceptionThrown', async () => {
    await capture.connect(server.port);
    // Allow WS setup to settle
    await new Promise((r) => setTimeout(r, 50));

    server.sendToAll({
      method: 'Runtime.exceptionThrown',
      params: {
        exceptionDetails: {
          text: 'Uncaught',
          exception: {
            description: 'TypeError: Cannot read properties of null',
          },
        },
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(1);
    expect(capture.capturedErrors[0]).toMatchObject({
      level: 'error',
      message: 'TypeError: Cannot read properties of null',
      source: 'cdp',
    });
    expect(capture.capturedErrors[0]!.ts).toBeGreaterThan(0);
  });

  it('handleMessage uses text fallback when exception.description is missing', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    server.sendToAll({
      method: 'Runtime.exceptionThrown',
      params: {
        exceptionDetails: {
          text: 'Script error.',
        },
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(1);
    expect(capture.capturedErrors[0]!.message).toBe('Script error.');
  });

  it('handleMessage parses Runtime.consoleAPICalled for error type', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    server.sendToAll({
      method: 'Runtime.consoleAPICalled',
      params: {
        type: 'error',
        args: [{ value: 'fetch failed' }, { description: 'for /api/data' }],
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(1);
    expect(capture.capturedErrors[0]).toMatchObject({
      level: 'error',
      message: 'fetch failed for /api/data',
      source: 'cdp',
    });
  });

  it('handleMessage parses Runtime.consoleAPICalled for warning type', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    server.sendToAll({
      method: 'Runtime.consoleAPICalled',
      params: {
        type: 'warning',
        args: [{ value: 'deprecated API used' }],
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(1);
    expect(capture.capturedErrors[0]).toMatchObject({
      level: 'warning',
      message: 'deprecated API used',
      source: 'cdp',
    });
  });

  it('handleMessage ignores non-error console calls (info, log)', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    server.sendToAll({
      method: 'Runtime.consoleAPICalled',
      params: {
        type: 'info',
        args: [{ value: 'informational message' }],
      },
    });

    server.sendToAll({
      method: 'Runtime.consoleAPICalled',
      params: {
        type: 'log',
        args: [{ value: 'plain log' }],
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(0);
  });

  it('handleMessage parses Log.entryAdded for error level', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    server.sendToAll({
      method: 'Log.entryAdded',
      params: {
        entry: {
          level: 'error',
          text: 'Failed to load resource: net::ERR_CONNECTION_REFUSED',
        },
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(1);
    expect(capture.capturedErrors[0]).toMatchObject({
      level: 'error',
      message: 'Failed to load resource: net::ERR_CONNECTION_REFUSED',
      source: 'cdp',
    });
  });

  it('handleMessage parses Log.entryAdded for warning level', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    server.sendToAll({
      method: 'Log.entryAdded',
      params: {
        entry: {
          level: 'warning',
          text: 'Cookie SameSite attribute missing',
        },
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(1);
    expect(capture.capturedErrors[0]).toMatchObject({
      level: 'warning',
      message: 'Cookie SameSite attribute missing',
      source: 'cdp',
    });
  });

  it('handleMessage ignores Log.entryAdded for non-error/warning levels', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    server.sendToAll({
      method: 'Log.entryAdded',
      params: {
        entry: { level: 'info', text: 'Page loaded' },
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(0);
  });

  it('caps errors at MAX_ERRORS (500)', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    // Send 510 errors
    for (let i = 0; i < 510; i++) {
      server.sendToAll({
        method: 'Runtime.consoleAPICalled',
        params: {
          type: 'error',
          args: [{ value: `error-${i}` }],
        },
      });
    }

    await new Promise((r) => setTimeout(r, 200));
    expect(capture.capturedErrors.length).toBeLessThanOrEqual(500);
    // The oldest errors should have been trimmed; most recent should be present
    const last = capture.capturedErrors[capture.capturedErrors.length - 1];
    expect(last!.message).toBe('error-509');
  });

  it('disconnect cleans up WebSocket', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    // Send one error before disconnect to confirm capture works
    server.sendToAll({
      method: 'Runtime.consoleAPICalled',
      params: {
        type: 'error',
        args: [{ value: 'before disconnect' }],
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(1);

    capture.disconnect();
    // Allow server-side close to propagate
    await new Promise((r) => setTimeout(r, 100));

    // After disconnect, new messages should not be captured
    server.sendToAll({
      method: 'Runtime.consoleAPICalled',
      params: {
        type: 'error',
        args: [{ value: 'after disconnect' }],
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    // Count should remain at 1 -- no new errors captured
    expect(capture.capturedErrors).toHaveLength(1);
    expect(capture.capturedErrors[0]!.message).toBe('before disconnect');
  });

  it('disconnect is safe to call multiple times', () => {
    expect(() => {
      capture.disconnect();
      capture.disconnect();
    }).not.toThrow();
  });

  it('discoverWsUrl parses /json response', async () => {
    // connect() internally calls discoverWsUrl, so a successful connect
    // proves the discovery worked for the page target
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    // Verify the WS is connected by sending an event and confirming capture
    server.sendToAll({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'error', args: [{ value: 'discovery-test' }] },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(1);
    expect(capture.capturedErrors[0]!.message).toBe('discovery-test');
  });

  it('handleMessage ignores malformed JSON', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    // Send raw invalid JSON
    for (const conn of server.connections) {
      conn.send('not-json{{{');
    }

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(0);
  });

  it('handleMessage ignores messages without method field', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    // This is a response message (has id but no method) -- should be ignored
    server.sendToAll({ id: 99, result: {} });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(0);
  });

  it('pushError skips empty messages', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    server.sendToAll({
      method: 'Log.entryAdded',
      params: {
        entry: { level: 'error', text: '' },
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(0);
  });

  it('connect() disconnects existing connection first', async () => {
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    // Send an error to the first connection
    server.sendToAll({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'error', args: [{ value: 'first-conn' }] },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(capture.capturedErrors).toHaveLength(1);

    // Reconnect -- old WS should be closed
    await capture.connect(server.port);
    await new Promise((r) => setTimeout(r, 50));

    // New events still arrive on the new connection
    server.sendToAll({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'error', args: [{ value: 'second-conn' }] },
    });
    await new Promise((r) => setTimeout(r, 50));
    // Errors accumulate across connections (no reset on reconnect)
    expect(capture.capturedErrors.length).toBeGreaterThanOrEqual(2);
  });
});
