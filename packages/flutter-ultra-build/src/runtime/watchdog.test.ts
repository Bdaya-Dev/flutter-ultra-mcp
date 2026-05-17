import { describe, expect, it } from 'vitest';
import { withWatchdog } from './watchdog.js';

interface FakeExtra {
  signal: AbortSignal;
  _meta?: Record<string, unknown>;
  sendNotification?: (n: { method: string; params?: Record<string, unknown> }) => Promise<void>;
}

function fakeExtra(): FakeExtra {
  return {
    signal: new AbortController().signal,
    _meta: { progressToken: 'tok-1' },
    sendNotification: async () => undefined,
  };
}

describe('withWatchdog', () => {
  it('returns the handler result when it resolves in time', async () => {
    const tool = withWatchdog<{ value: number }>(
      { name: 'sample', ceilingMs: 1000, toolClass: 'quick' },
      async (args) => ({
        content: [{ type: 'text', text: String(args.value + 1) }],
      }),
    );
    const res = await tool({ value: 41 }, fakeExtra());
    const first = res.content[0];
    expect(first).toBeDefined();
    if (first && first.type === 'text') {
      expect(first.text).toBe('42');
    }
    expect(res.isError).toBeUndefined();
  });

  it('returns a structured error result when the ceiling fires', async () => {
    const tool = withWatchdog<Record<string, never>>(
      { name: 'slow', ceilingMs: 50, toolClass: 'quick' },
      async (_args, ctx) =>
        new Promise((resolve) => {
          // Long-runner that respects the abort signal so the watchdog can
          // tear it down. Resolves with a sentinel if abort fires.
          ctx.signal.addEventListener('abort', () =>
            resolve({ content: [{ type: 'text', text: 'aborted-handler-still-resolves' }] }),
          );
          setTimeout(
            () => resolve({ content: [{ type: 'text', text: 'should-not-reach' }] }),
            10_000,
          ).unref();
        }),
    );
    const res = await tool({}, fakeExtra());
    expect(res.isError).toBe(true);
    const first = res.content[0];
    expect(first).toBeDefined();
    if (first && first.type === 'text') {
      expect(first.text).toMatch(/exceeded its 50ms ceiling/);
    }
  });

  it('propagates host-side abort to handler signal', async () => {
    const controller = new AbortController();
    const extra: FakeExtra = {
      signal: controller.signal,
      sendNotification: async () => undefined,
    };
    let observedAbort = false;
    const handler = withWatchdog<Record<string, never>>(
      { name: 'cancellable', ceilingMs: 5_000, toolClass: 'quick' },
      async (_args, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener('abort', () => {
            observedAbort = true;
            resolve({ content: [{ type: 'text', text: 'cancelled-by-host' }] });
          });
        }),
    );
    const pending = handler({}, extra);
    setTimeout(() => controller.abort(), 25).unref();
    const res = await pending;
    expect(observedAbort).toBe(true);
    const first = res.content[0];
    expect(first).toBeDefined();
    if (first && first.type === 'text') {
      expect(first.text).toBe('cancelled-by-host');
    }
  });
});
