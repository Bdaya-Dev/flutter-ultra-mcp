import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { JsonRpcClient, JsonRpcError } from './jsonRpcClient.js';
import type { RpcStream } from '../device/types.js';

function makeMockStream(): {
  stream: RpcStream;
  writes: string[];
  pushStdout(line: string): void;
  pushStderr(line: string): void;
  exitWith(code: number): void;
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writes: string[] = [];
  stdin.on('data', (chunk: Buffer) => writes.push(chunk.toString()));
  let resolveExit!: (n: number | null) => void;
  const exit = new Promise<number | null>((r) => {
    resolveExit = r;
  });
  return {
    stream: {
      stdin,
      stdout,
      stderr,
      pid: 12345,
      exit,
      async kill() {
        resolveExit(143);
      },
    },
    writes,
    pushStdout(line: string) {
      stdout.write(line);
    },
    pushStderr(line: string) {
      stderr.write(line);
    },
    exitWith(code: number) {
      resolveExit(code);
    },
  };
}

describe('JsonRpcClient', () => {
  it('serializes a request and resolves with the matching response', async () => {
    const mock = makeMockStream();
    const client = new JsonRpcClient(mock.stream);
    const callPromise = client.call('hello', { foo: 1 });
    // The client wrote exactly one frame; assert its shape.
    await vi.waitFor(() => expect(mock.writes.length).toBeGreaterThan(0));
    const sent = JSON.parse(mock.writes[0].trim()) as {
      jsonrpc: string;
      id: number;
      method: string;
      params: unknown;
    };
    expect(sent.jsonrpc).toBe('2.0');
    expect(sent.method).toBe('hello');
    expect(sent.params).toEqual({ foo: 1 });
    expect(typeof sent.id).toBe('number');
    mock.pushStdout(JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { ok: true } }) + '\n');
    await expect(callPromise).resolves.toEqual({ ok: true });
    await client.close();
  });

  it('rejects with JsonRpcError on remote error payload', async () => {
    const mock = makeMockStream();
    const client = new JsonRpcClient(mock.stream);
    const callPromise = client.call('boom');
    await vi.waitFor(() => expect(mock.writes.length).toBeGreaterThan(0));
    const sent = JSON.parse(mock.writes[0].trim()) as { id: number };
    mock.pushStdout(
      JSON.stringify({
        jsonrpc: '2.0',
        id: sent.id,
        error: { code: -32_000, message: 'nope', data: { detail: 'tcc' } },
      }) + '\n',
    );
    await expect(callPromise).rejects.toBeInstanceOf(JsonRpcError);
    try {
      await callPromise;
    } catch (e) {
      expect((e as JsonRpcError).code).toBe(-32_000);
      expect((e as JsonRpcError).message).toBe('nope');
      expect((e as JsonRpcError).data).toEqual({ detail: 'tcc' });
    }
    await client.close();
  });

  it('rejects pending calls when the sidecar exits prematurely', async () => {
    const mock = makeMockStream();
    const client = new JsonRpcClient(mock.stream);
    const callPromise = client.call('idle');
    mock.exitWith(1);
    await expect(callPromise).rejects.toThrow(/Sidecar exited/);
    await client.close();
  });

  it('surfaces stderr lines through the onStderr callback', async () => {
    const stderrLines: string[] = [];
    const mock = makeMockStream();
    const client = new JsonRpcClient(mock.stream, {
      onStderr: (line) => stderrLines.push(line),
    });
    mock.pushStderr('first line\nsecond line\n');
    await vi.waitFor(() => expect(stderrLines).toContain('second line'));
    expect(stderrLines).toEqual(['first line', 'second line']);
    await client.close();
  });

  it('forwards notifications without an id', async () => {
    const notes: Array<{ method: string; params?: unknown }> = [];
    const mock = makeMockStream();
    const client = new JsonRpcClient(mock.stream, {
      onNotification: (n) => notes.push({ method: n.method, params: n.params }),
    });
    mock.pushStdout(
      JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: { step: 1 } }) + '\n',
    );
    await vi.waitFor(() => expect(notes.length).toBe(1));
    expect(notes[0]).toEqual({ method: 'progress', params: { step: 1 } });
    await client.close();
  });

  it('times out a call when no response arrives', async () => {
    const mock = makeMockStream();
    const client = new JsonRpcClient(mock.stream);
    const callPromise = client.call('hang', undefined, 25);
    await expect(callPromise).rejects.toThrow(/timed out/);
    await client.close();
  });
});
