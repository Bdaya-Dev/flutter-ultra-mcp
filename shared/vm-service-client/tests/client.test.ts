// Unit tests for VmServiceClient.
//
// Each test starts a real ws server on an ephemeral port, registers handlers
// for the methods under test, runs the client against it, and asserts the
// parsed result shape.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConnectionDisposedError,
  RpcError,
  SentinelException,
  VmServiceClient,
  buildWsUri,
} from '../src/index.js';
import { MockVmServer } from './mock-server.js';

describe('buildWsUri', () => {
  it('passes through a complete ws:// URI', () => {
    expect(buildWsUri('ws://127.0.0.1:8181/abc/ws')).toBe('ws://127.0.0.1:8181/abc/ws');
  });

  it('accepts wss:// URIs', () => {
    expect(buildWsUri('wss://example.com:443/ws')).toBe('wss://example.com:443/ws');
  });

  it('builds from {host, port, ws_path}', () => {
    expect(buildWsUri({ host: '127.0.0.1', port: 8181, ws_path: 'token/ws' })).toBe(
      'ws://127.0.0.1:8181/token/ws',
    );
  });

  it('prepends slash to ws_path if missing', () => {
    expect(buildWsUri({ host: '127.0.0.1', port: 8181, ws_path: 'ws' })).toBe(
      'ws://127.0.0.1:8181/ws',
    );
  });

  it('rejects URIs without ws/wss scheme', () => {
    expect(() => buildWsUri('http://example.com/ws')).toThrow();
  });
});

describe('VmServiceClient', () => {
  let server: MockVmServer;
  let uri: string;
  let client: VmServiceClient;

  beforeEach(async () => {
    server = new MockVmServer();
    uri = await server.start('/ws');
  });

  afterEach(async () => {
    await client?.dispose();
    await server.stop();
  });

  describe('connection lifecycle', () => {
    it('connects to ws URI', async () => {
      client = new VmServiceClient(uri, { autoReconnect: false });
      await client.connect();
      expect(client.transport.isOpen).toBe(true);
    });

    it('connects via {host, port, ws_path} triple', async () => {
      client = new VmServiceClient(
        { host: '127.0.0.1', port: server.port, ws_path: '/ws' },
        { autoReconnect: false },
      );
      await client.connect();
      expect(client.transport.isOpen).toBe(true);
    });

    it('sets DDS client name on connect when configured', async () => {
      let observed: unknown;
      server.on('setClientName', (params) => {
        observed = params;
        return { result: { type: 'Success' } };
      });
      client = new VmServiceClient(uri, {
        clientName: 'flutter-ultra/runtime/12345',
        autoReconnect: false,
      });
      await client.connect();
      expect(observed).toEqual({ name: 'flutter-ultra/runtime/12345' });
    });

    it('rejects pending RPC with ConnectionDisposedError on server close', async () => {
      // Handler never responds, so the request hangs until we close the socket.
      server.on('getVM', () => new Promise(() => {}));
      client = new VmServiceClient(uri, { autoReconnect: false });
      await client.connect();
      const pending = client.getVM();
      setTimeout(() => server.closeAllClients(), 50);
      await expect(pending).rejects.toBeInstanceOf(ConnectionDisposedError);
    });
  });

  describe('core RPCs', () => {
    beforeEach(async () => {
      client = new VmServiceClient(uri, { autoReconnect: false });
      await client.connect();
    });

    it('getVM parses VM response', async () => {
      server.on('getVM', () => ({
        result: {
          type: 'VM',
          name: 'vm',
          architectureBits: 64,
          hostCPU: 'x64',
          operatingSystem: 'linux',
          targetCPU: 'x64',
          version: '3.5.0',
          pid: 12345,
          startTime: 1700000000000,
          isolates: [
            { type: '@Isolate', id: 'isolates/1', name: 'main' },
          ],
          isolateGroups: [
            { type: '@IsolateGroup', id: 'isolateGroups/1', name: 'main' },
          ],
        },
      }));
      const vm = await client.getVM();
      expect(vm.pid).toBe(12345);
      expect(vm.isolates[0]!.id).toBe('isolates/1');
    });

    it('getIsolate parses Isolate response', async () => {
      server.on('getIsolate', (params) => {
        expect(params).toEqual({ isolateId: 'isolates/1' });
        return {
          result: {
            type: 'Isolate',
            id: 'isolates/1',
            number: '1',
            name: 'main',
            startTime: 1700000000000,
            runnable: true,
            livePorts: 1,
            pauseOnExit: false,
            extensionRPCs: ['ext.flutter.ultra.getVersion'],
          },
        };
      });
      const iso = await client.getIsolate('isolates/1');
      expect(iso.runnable).toBe(true);
      expect(iso.extensionRPCs).toContain('ext.flutter.ultra.getVersion');
    });

    it('getIsolate throws SentinelException when isolate gone', async () => {
      server.on('getIsolate', () => ({
        result: { type: 'Sentinel', kind: 'Collected', valueAsString: '<collected>' },
      }));
      await expect(client.getIsolate('isolates/99')).rejects.toBeInstanceOf(SentinelException);
    });

    it('getObject parses generic Obj response', async () => {
      server.on('getObject', () => ({
        result: { type: 'Library', id: 'libraries/42', name: 'package:flutter/widgets.dart' },
      }));
      const obj = await client.getObject('isolates/1', 'libraries/42');
      expect(obj.type).toBe('Library');
      expect(obj.id).toBe('libraries/42');
    });

    it('evaluate returns InstanceRef on success', async () => {
      server.on('evaluate', () => ({
        result: { type: '@Instance', id: 'objects/1', kind: 'String', valueAsString: 'hello' },
      }));
      const r = await client.evaluate('isolates/1', 'isolates/1', '"hello"');
      expect(r.type).toBe('@Instance');
      if (r.type === '@Instance') expect(r.valueAsString).toBe('hello');
    });

    it('evaluate returns ErrorRef on expression failure', async () => {
      server.on('evaluate', () => ({
        result: {
          type: '@Error',
          id: 'errors/1',
          kind: 'UnhandledException',
          message: 'No such method',
        },
      }));
      const r = await client.evaluate('isolates/1', 'isolates/1', 'foo.bar');
      expect(r.type).toBe('@Error');
      if (r.type === '@Error') expect(r.message).toBe('No such method');
    });

    it('evaluate returns Sentinel when isolate paused', async () => {
      server.on('evaluate', () => ({
        result: { type: 'Sentinel', kind: 'NotInitialized', valueAsString: '<not initialized>' },
      }));
      const r = await client.evaluate('isolates/1', 'isolates/1', 'x');
      expect(r.type).toBe('Sentinel');
    });

    it('evaluateInFrame passes frameIndex', async () => {
      server.on('evaluateInFrame', (params) => {
        expect((params as { frameIndex: number }).frameIndex).toBe(2);
        return {
          result: { type: '@Instance', id: 'objects/2', kind: 'Int', valueAsString: '42' },
        };
      });
      const r = await client.evaluateInFrame('isolates/1', 2, 'x + y');
      expect(r.type).toBe('@Instance');
    });

    it('callServiceExtension forwards args and returns raw JSON', async () => {
      server.on('ext.flutter.inspector.screenshot', (params) => {
        expect(params).toMatchObject({ isolateId: 'isolates/1', width: 400 });
        return { result: { type: '_extensionType', screenshot: 'iVBORw==' } };
      });
      const r = await client.callServiceExtension('ext.flutter.inspector.screenshot', {
        isolateId: 'isolates/1',
        args: { width: 400 },
      });
      expect(r).toMatchObject({ screenshot: 'iVBORw==' });
    });

    it('streamListen / streamCancel return Success', async () => {
      server.on('streamListen', () => ({ result: { type: 'Success' } }));
      server.on('streamCancel', () => ({ result: { type: 'Success' } }));
      const listen = await client.streamListen('Logging');
      const cancel = await client.streamCancel('Logging');
      expect(listen.type).toBe('Success');
      expect(cancel.type).toBe('Success');
    });

    it('getFlagList parses FlagList', async () => {
      server.on('getFlagList', () => ({
        result: {
          type: 'FlagList',
          flags: [
            { name: 'pause_isolates_on_start', comment: 'X', modified: false, valueAsString: 'false' },
          ],
        },
      }));
      const fl = await client.getFlagList();
      expect(fl.flags).toHaveLength(1);
      expect(fl.flags[0]!.name).toBe('pause_isolates_on_start');
    });

    it('setLibraryDebuggable returns Success', async () => {
      server.on('setLibraryDebuggable', (params) => {
        expect(params).toEqual({
          isolateId: 'isolates/1',
          libraryId: 'libraries/2',
          isDebuggable: true,
        });
        return { result: { type: 'Success' } };
      });
      const r = await client.setLibraryDebuggable('isolates/1', 'libraries/2', true);
      expect(r.type).toBe('Success');
    });

    it('getInstances parses InstanceSet', async () => {
      server.on('getInstances', (params) => {
        expect((params as { limit: number }).limit).toBe(10);
        return {
          result: {
            type: 'InstanceSet',
            totalCount: 3,
            instances: [
              { type: '@Instance', id: 'objects/1', kind: 'PlainInstance' },
              { type: '@Instance', id: 'objects/2', kind: 'PlainInstance' },
              { type: '@Instance', id: 'objects/3', kind: 'PlainInstance' },
            ],
          },
        };
      });
      const set = await client.getInstances('isolates/1', 'classes/MyClass', 10);
      expect(set.totalCount).toBe(3);
      expect(set.instances).toHaveLength(3);
    });

    it('getStack parses Stack with frames', async () => {
      server.on('getStack', () => ({
        result: {
          type: 'Stack',
          frames: [{ type: 'Frame', index: 0 }],
          truncated: false,
        },
      }));
      const stack = await client.getStack('isolates/1');
      expect(stack.frames).toHaveLength(1);
      expect(stack.truncated).toBe(false);
    });

    it('resume returns Success and passes step kind', async () => {
      server.on('resume', (params) => {
        expect(params).toEqual({ isolateId: 'isolates/1', step: 'Into' });
        return { result: { type: 'Success' } };
      });
      const r = await client.resume('isolates/1', { step: 'Into' });
      expect(r.type).toBe('Success');
    });

    it('pause returns Success', async () => {
      server.on('pause', () => ({ result: { type: 'Success' } }));
      const r = await client.pause('isolates/1');
      expect(r.type).toBe('Success');
    });
  });

  describe('DDS RPCs', () => {
    beforeEach(async () => {
      client = new VmServiceClient(uri, { autoReconnect: false });
      await client.connect();
    });

    it('setClientName succeeds', async () => {
      server.on('setClientName', (params) => {
        expect(params).toEqual({ name: 'flutter-ultra/runtime/1' });
        return { result: { type: 'Success' } };
      });
      const r = await client.setClientName('flutter-ultra/runtime/1');
      expect(r.type).toBe('Success');
    });

    it('getStreamHistory replays buffered events', async () => {
      server.on('getStreamHistory', () => ({
        result: {
          type: 'StreamHistory',
          history: [
            { type: 'Event', kind: 'Logging', timestamp: 1700000000000 },
            { type: 'Event', kind: 'Logging', timestamp: 1700000000010 },
          ],
        },
      }));
      const hist = await client.getStreamHistory('Logging');
      expect(hist.history).toHaveLength(2);
    });

    it('NEVER calls requirePermissionToResume', () => {
      // Compile-time guard: assert the symbol isn't on the public surface.
      const proto = Object.getPrototypeOf(client) as Record<string, unknown>;
      expect(proto).not.toHaveProperty('requirePermissionToResume');
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      client = new VmServiceClient(uri, { autoReconnect: false });
      await client.connect();
    });

    it('propagates RpcError on JSON-RPC error response', async () => {
      server.on('getVM', () => ({
        error: { code: -32000, message: 'Boom' },
      }));
      await expect(client.getVM()).rejects.toBeInstanceOf(RpcError);
    });

    it('RpcError includes method name in message', async () => {
      server.on('getIsolate', () => ({
        error: { code: 106, message: 'Isolate must be paused' },
      }));
      try {
        await client.getIsolate('isolates/1');
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RpcError);
        expect((err as RpcError).code).toBe(106);
        expect((err as Error).message).toContain('getIsolate');
        expect((err as Error).message).toContain('Isolate must be paused');
      }
    });
  });

  describe('event streams', () => {
    beforeEach(async () => {
      client = new VmServiceClient(uri, { autoReconnect: false });
      await client.connect();
    });

    it('emits isolateEvent on streamNotify(Isolate, ...)', async () => {
      const received: unknown[] = [];
      client.on('isolateEvent', (e) => received.push(e));
      server.broadcast('streamNotify', {
        streamId: 'Isolate',
        event: {
          type: 'Event',
          kind: 'IsolateStart',
          timestamp: 1700000000000,
          isolate: { type: '@Isolate', id: 'isolates/1', name: 'main' },
        },
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(received).toHaveLength(1);
    });

    it('emits extensionEvent on Extension stream', async () => {
      const received: unknown[] = [];
      client.on('extensionEvent', (e) => received.push(e));
      server.broadcast('streamNotify', {
        streamId: 'Extension',
        event: {
          type: 'Event',
          kind: 'Extension',
          timestamp: 1700000000000,
          extensionKind: 'Flutter.Frame',
          extensionData: { number: 42 },
        },
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(received).toHaveLength(1);
    });

    it('onIsolateEvent yields events as async iterator', async () => {
      const iter = client.onIsolateEvent();
      server.broadcast('streamNotify', {
        streamId: 'Isolate',
        event: { type: 'Event', kind: 'IsolateRunnable', timestamp: 1 },
      });
      const next = await iter.next();
      expect(next.done).toBe(false);
      expect(next.value.kind).toBe('IsolateRunnable');
      await iter.return!();
    });
  });

  describe('reconnect', () => {
    it('schedules reconnect with exp backoff after disconnect', async () => {
      client = new VmServiceClient(uri, {
        autoReconnect: true,
        reconnectDelaysMs: [10, 20, 40],
      });
      await client.connect();
      const reconnectAttempts: number[] = [];
      client.transport.on('reconnecting', (attempt, delay) => {
        reconnectAttempts.push(delay);
      });
      const reconnected = new Promise<void>((resolve) =>
        client.transport.once('reconnected', () => resolve()),
      );
      // Drop the client connection from the server side.
      server.closeAllClients();
      await reconnected;
      expect(reconnectAttempts[0]).toBe(10);
      expect(client.transport.isOpen).toBe(true);
    });
  });
});
