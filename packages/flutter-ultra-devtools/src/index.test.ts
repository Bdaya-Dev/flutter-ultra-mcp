import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { PanelServer } from './panelServer.js';
import { EventBus } from './eventBus.js';
import { createLogger } from '@flutter-ultra/mcp-runtime';

const TEST_PORT = 19170;

function makeLogger() {
  return createLogger({ server: 'test-devtools' });
}

describe('PanelServer', () => {
  let server: PanelServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('starts and returns ws url', async () => {
    server = new PanelServer(makeLogger());
    const url = await server.start(TEST_PORT);
    expect(url).toBe(`ws://127.0.0.1:${TEST_PORT}`);
    const status = server.getStatus();
    expect(status.running).toBe(true);
    expect(status.port).toBe(TEST_PORT);
    expect(status.viewers).toBe(0);
  });

  it('accepts panel connections and tracks viewers', async () => {
    server = new PanelServer(makeLogger());
    await server.start(TEST_PORT);

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    const welcome = await new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    expect(welcome['type']).toBe('welcome');
    expect(welcome['viewerId']).toBeDefined();

    const status = server.getStatus();
    expect(status.viewers).toBe(1);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.getStatus().viewers).toBe(0);
  });

  it('broadcasts events to connected viewers', async () => {
    server = new PanelServer(makeLogger());
    await server.start(TEST_PORT);

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    await new Promise<void>((resolve) => {
      ws.on('message', () => resolve());
    });

    const eventBus = new EventBus(server);
    const event = eventBus.createEvent('tool_call', 'flutter-ultra-gesture', 'tap', {
      target: 'button',
    });

    const received = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    const delivered = server.broadcast(event);
    expect(delivered).toBe(1);

    const msg = await received;
    expect(msg['type']).toBe('tool_call');
    expect(msg['server']).toBe('flutter-ultra-gesture');
    expect(msg['tool']).toBe('tap');

    ws.close();
  });

  it('handles panel commands (human-in-the-loop)', async () => {
    server = new PanelServer(makeLogger());
    await server.start(TEST_PORT);

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    await new Promise<void>((resolve) => {
      ws.on('message', () => resolve());
    });

    const commandPromise = server.waitForCommand(5000);

    ws.send(JSON.stringify({ type: 'command', payload: { command: 'pause' } }));

    const cmd = await commandPromise;
    expect(cmd.type).toBe('pause');
    expect(cmd.payload['command']).toBe('pause');
    expect(cmd.viewerId).toBeDefined();

    ws.close();
  });

  it('waitForCommand times out', async () => {
    server = new PanelServer(makeLogger());
    await server.start(TEST_PORT);

    await expect(server.waitForCommand(100)).rejects.toThrow('No panel command received');
  });

  it('stop disconnects all viewers gracefully', async () => {
    server = new PanelServer(makeLogger());
    await server.start(TEST_PORT);

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    await new Promise<void>((resolve) => {
      ws.on('message', () => resolve());
    });

    const closed = new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code));
    });

    await server.stop();
    const code = await closed;
    expect(code).toBe(1001);
  });

  it('is idempotent on start with same port', async () => {
    server = new PanelServer(makeLogger());
    const url1 = await server.start(TEST_PORT);
    const url2 = await server.start(TEST_PORT);
    expect(url1).toBe(url2);
  });
});

describe('EventBus', () => {
  it('creates structured events with UUID and timestamp', () => {
    const panelServer = new PanelServer(makeLogger());
    const bus = new EventBus(panelServer);
    const event = bus.createEvent('tool_call', 'flutter-ultra-runtime', 'hot_reload', {
      success: true,
    });

    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(event.type).toBe('tool_call');
    expect(event.server).toBe('flutter-ultra-runtime');
    expect(event.tool).toBe('hot_reload');
    expect(event.payload).toEqual({ success: true });
    expect(event.timestamp).toBeDefined();
  });
});
