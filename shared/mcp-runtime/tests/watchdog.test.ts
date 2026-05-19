import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithWatchdog, ToolWatchdogTimeoutError } from '../src/index.js';
import { resolveCeiling } from '../src/watchdog.js';

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

describe('resolveCeiling', () => {
  afterEach(() => {
    delete process.env['FLUTTER_ULTRA_TOOL_TIMEOUT_MY_TOOL'];
    delete process.env['FLUTTER_ULTRA_TIMEOUT_MULTIPLIER'];
  });

  it('returns the explicit ceilingMs when no env vars are set', () => {
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick', ceilingMs: 10_000 })).toBe(10_000);
  });

  it('falls back to DEFAULT_CEILINGS_MS when ceilingMs is omitted', () => {
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'instant' })).toBe(10_000);
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick' })).toBe(30_000);
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'long' })).toBe(55_000);
  });

  it('applies FLUTTER_ULTRA_TIMEOUT_MULTIPLIER to the base ceiling', () => {
    process.env['FLUTTER_ULTRA_TIMEOUT_MULTIPLIER'] = '2';
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick', ceilingMs: 10_000 })).toBe(20_000);
  });

  it('applies fractional multiplier and rounds the result', () => {
    process.env['FLUTTER_ULTRA_TIMEOUT_MULTIPLIER'] = '1.5';
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick', ceilingMs: 10_001 })).toBe(15_002);
  });

  it('per-tool env override takes precedence over multiplier', () => {
    process.env['FLUTTER_ULTRA_TOOL_TIMEOUT_MY_TOOL'] = '99000';
    process.env['FLUTTER_ULTRA_TIMEOUT_MULTIPLIER'] = '100';
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick', ceilingMs: 10_000 })).toBe(99_000);
  });

  it('ignores invalid (non-numeric) FLUTTER_ULTRA_TIMEOUT_MULTIPLIER', () => {
    process.env['FLUTTER_ULTRA_TIMEOUT_MULTIPLIER'] = 'bad';
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick', ceilingMs: 10_000 })).toBe(10_000);
  });

  it('ignores zero FLUTTER_ULTRA_TIMEOUT_MULTIPLIER', () => {
    process.env['FLUTTER_ULTRA_TIMEOUT_MULTIPLIER'] = '0';
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick', ceilingMs: 10_000 })).toBe(10_000);
  });

  it('ignores negative FLUTTER_ULTRA_TIMEOUT_MULTIPLIER', () => {
    process.env['FLUTTER_ULTRA_TIMEOUT_MULTIPLIER'] = '-2';
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick', ceilingMs: 10_000 })).toBe(10_000);
  });

  it('ignores invalid (non-numeric) per-tool env override and falls back to base ceiling', () => {
    process.env['FLUTTER_ULTRA_TOOL_TIMEOUT_MY_TOOL'] = 'not_a_number';
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick', ceilingMs: 10_000 })).toBe(10_000);
  });

  it('ignores zero per-tool env override and falls back to base ceiling', () => {
    process.env['FLUTTER_ULTRA_TOOL_TIMEOUT_MY_TOOL'] = '0';
    expect(resolveCeiling({ name: 'my_tool', timeoutClass: 'quick', ceilingMs: 10_000 })).toBe(10_000);
  });
});
