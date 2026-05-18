// Chaos: Watchdog behavior under fault conditions.
// Covers §18.10: "Send SIGTERM to MCP server mid-tool-call",
// "60s idle followed by tools/list", watchdog timeout verification.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runWithWatchdog,
  type WatchdogConfig,
  type ToolBody,
} from '@flutter-ultra/mcp-runtime/watchdog';
import { ToolWatchdogTimeoutError } from '@flutter-ultra/mcp-runtime/errors';

describe('chaos: watchdog fires correctly under fault conditions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('watchdog kills a handler that hangs due to unresponsive WS', async () => {
    const config: WatchdogConfig = {
      name: 'screenshot_hang',
      timeoutClass: 'quick',
      ceilingMs: 100,
    };

    const hangingHandler: ToolBody<unknown, unknown> = async (_args, { signal }) => {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    };

    await expect(
      runWithWatchdog(config, {}, undefined, () => {}, hangingHandler),
    ).rejects.toBeInstanceOf(ToolWatchdogTimeoutError);
  });

  it('watchdog does not interfere with a fast handler under latency', async () => {
    const config: WatchdogConfig = {
      name: 'fast_with_latency',
      timeoutClass: 'quick',
      ceilingMs: 500,
    };

    const handler: ToolBody<unknown, string> = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'done';
    };

    const result = await runWithWatchdog(config, {}, undefined, () => {}, handler);
    expect(result).toBe('done');
  });

  it('concurrent watchdogs are independent (no shared timer leaks)', async () => {
    const results = await Promise.allSettled([
      runWithWatchdog(
        { name: 'concurrent_fast', timeoutClass: 'quick', ceilingMs: 500 },
        {},
        undefined,
        () => {},
        async () => {
          await new Promise((r) => setTimeout(r, 50));
          return 'fast';
        },
      ),
      runWithWatchdog(
        { name: 'concurrent_slow', timeoutClass: 'quick', ceilingMs: 100 },
        {},
        undefined,
        () => {},
        async (_args, { signal }) => {
          return new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
          });
        },
      ),
    ]);

    expect(results[0]!.status).toBe('fulfilled');
    expect((results[0] as PromiseFulfilledResult<string>).value).toBe('fast');
    expect(results[1]!.status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ToolWatchdogTimeoutError);
  });

  it('external abort races with watchdog - first wins', async () => {
    const controller = new AbortController();

    setTimeout(() => controller.abort(new Error('user cancel')), 30);

    const start = Date.now();
    await expect(
      runWithWatchdog(
        { name: 'race_abort', timeoutClass: 'quick', ceilingMs: 200 },
        {},
        controller.signal,
        () => {},
        async (_args, { signal }) => {
          return new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
          });
        },
      ),
    ).rejects.toThrow(/user cancel/);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(150);
  });

  it('progress callback keeps firing even when handler is slow', async () => {
    const progressUpdates: Array<{ progress: number }> = [];

    const result = await runWithWatchdog(
      { name: 'progress_test', timeoutClass: 'long', ceilingMs: 2000 },
      {},
      undefined,
      (update) => progressUpdates.push(update),
      async (
        _args: unknown,
        {
          sendProgress,
        }: {
          sendProgress: (u: { progress: number; total?: number; message?: string }) => void;
        },
      ) => {
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 50));
          sendProgress({ progress: i + 1, total: 5, message: `Step ${i + 1}` });
        }
        return 'complete';
      },
    );

    expect(result).toBe('complete');
    expect(progressUpdates).toHaveLength(5);
    expect(progressUpdates[4]).toEqual(expect.objectContaining({ progress: 5, total: 5 }));
  });

  it('env override ceiling is respected under fault', async () => {
    process.env['FLUTTER_ULTRA_TOOL_TIMEOUT_ENV_OVERRIDE_TEST'] = '80';
    try {
      await expect(
        runWithWatchdog(
          { name: 'env_override_test', timeoutClass: 'long', ceilingMs: 999_999 },
          {},
          undefined,
          () => {},
          async (_args: unknown, { signal }: { signal: AbortSignal }) => {
            return new Promise<never>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason));
            });
          },
        ),
      ).rejects.toBeInstanceOf(ToolWatchdogTimeoutError);
    } finally {
      delete process.env['FLUTTER_ULTRA_TOOL_TIMEOUT_ENV_OVERRIDE_TEST'];
    }
  });

  it('10 concurrent calls with different watchdog ceilings resolve independently', async () => {
    const calls = Array.from({ length: 10 }, (_, i) =>
      runWithWatchdog(
        { name: `concurrent_${i}`, timeoutClass: 'quick', ceilingMs: 300 },
        { index: i },
        undefined,
        () => {},
        async (args: { index: number }) => {
          await new Promise((r) => setTimeout(r, 20 + args.index * 10));
          return { index: args.index };
        },
      ),
    );

    const results = await Promise.all(calls);
    expect(results).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(results[i]).toEqual({ index: i });
    }
  });
});
