import { describe, expect, it, vi } from 'vitest';
import { runWithWatchdog, ToolWatchdogTimeoutError } from '../src/index.js';

describe('runWithWatchdog', () => {
  it('returns the handler value when it finishes inside the ceiling', async () => {
    const result = await runWithWatchdog(
      { name: 'test', timeoutClass: 'quick', ceilingMs: 200 },
      { foo: 'bar' },
      undefined,
      () => {},
      async (args) => ({ echoed: args.foo }),
    );
    expect(result).toEqual({ echoed: 'bar' });
  });

  it('throws ToolWatchdogTimeoutError when the handler runs longer than the ceiling', async () => {
    await expect(
      runWithWatchdog(
        { name: 'slow', timeoutClass: 'quick', ceilingMs: 30 },
        {},
        undefined,
        () => {},
        async (_args, { signal }) => {
          return new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason as Error));
          });
        },
      ),
    ).rejects.toBeInstanceOf(ToolWatchdogTimeoutError);
  });

  it('propagates an external AbortSignal to the handler', async () => {
    const controller = new AbortController();
    const handler = vi.fn(async (_args: unknown, { signal }: { signal: AbortSignal }) => {
      return new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    setTimeout(() => controller.abort(new Error('user cancel')), 10);
    await expect(
      runWithWatchdog(
        { name: 'cancel', timeoutClass: 'quick', ceilingMs: 1_000 },
        {},
        controller.signal,
        () => {},
        handler as never,
      ),
    ).rejects.toThrow(/aborted/);
    expect(handler).toHaveBeenCalled();
  });

  it('respects FLUTTER_ULTRA_TOOL_TIMEOUT_<NAME> env override', async () => {
    process.env['FLUTTER_ULTRA_TOOL_TIMEOUT_OVERRIDE_TOOL'] = '50';
    try {
      await expect(
        runWithWatchdog(
          { name: 'override_tool', timeoutClass: 'quick', ceilingMs: 1_000_000 },
          {},
          undefined,
          () => {},
          async (_args, { signal }) => {
            return new Promise<never>((_, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason as Error));
            });
          },
        ),
      ).rejects.toBeInstanceOf(ToolWatchdogTimeoutError);
    } finally {
      delete process.env['FLUTTER_ULTRA_TOOL_TIMEOUT_OVERRIDE_TOOL'];
    }
  });
});
