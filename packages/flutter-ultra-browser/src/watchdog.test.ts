import { describe, it, expect } from 'vitest';
import { withWatchdog, type ToolReturn } from './watchdog.js';

describe('withWatchdog', () => {
  it('returns result for fast handlers', async () => {
    const wrapped = withWatchdog<{ x: number }, ToolReturn>(
      { name: 'test_fast', ceilingMs: 1_000, class: 'quick' },
      async (args) => ({ content: [{ type: 'text', text: `got ${args.x}` }] }),
    );
    const r = await wrapped({ x: 7 });
    expect(r.content[0]).toEqual({ type: 'text', text: 'got 7' });
  });

  it('fires watchdog and returns isError', async () => {
    const wrapped = withWatchdog<unknown, ToolReturn>(
      { name: 'test_hang', ceilingMs: 50, class: 'quick' },
      () => new Promise(() => {}), // never resolves
    );
    const r = await wrapped({});
    expect(r.isError).toBe(true);
    const c = r.content[0];
    expect(c.type).toBe('text');
    if (c.type === 'text') expect(c.text).toContain('ceiling');
  });

  it('honours FLUTTER_ULTRA_TOOL_TIMEOUT_<NAME> env override', async () => {
    process.env.FLUTTER_ULTRA_TOOL_TIMEOUT_TEST_ENV_OVERRIDE = '30';
    try {
      const wrapped = withWatchdog<unknown, ToolReturn>(
        // default would be very long; env shortens it.
        { name: 'test_env_override', ceilingMs: 60_000, class: 'long' },
        () => new Promise(() => {}),
      );
      const start = Date.now();
      const r = await wrapped({});
      const elapsed = Date.now() - start;
      expect(r.isError).toBe(true);
      expect(elapsed).toBeLessThan(500);
    } finally {
      delete process.env.FLUTTER_ULTRA_TOOL_TIMEOUT_TEST_ENV_OVERRIDE;
    }
  });

  it('propagates upstream signal to abort handler', async () => {
    let aborted = false;
    const wrapped = withWatchdog<unknown, ToolReturn>(
      { name: 'test_signal', ceilingMs: 10_000, class: 'long' },
      (_args, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener('abort', () => {
            aborted = true;
            resolve({ content: [{ type: 'text', text: 'aborted' }], isError: true });
          });
        }),
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await wrapped({}, { signal: controller.signal });
    expect(aborted).toBe(true);
  });
});
