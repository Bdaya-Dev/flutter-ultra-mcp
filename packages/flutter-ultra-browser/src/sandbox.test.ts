// Sandbox boundary tests — verify the security surface from plan §5.4 lines
// 633-651: page/context/browser/console/fetch exposed; process/require/import
// blocked; CPU + wall-time watchdog kicks in.
//
// We don't need a real Playwright browser here — we pass stub objects in for
// page/context/browser. These tests prove the sandbox primitives, not the
// Playwright API surface.

import { describe, it, expect } from 'vitest';
import { runPlaywrightScript } from './sandbox.js';
import type { Browser, BrowserContext, Page } from 'playwright-core';

const stubPage = { url: () => 'about:blank', __stub: true } as unknown as Page;
const stubContext = { __stub: true } as unknown as BrowserContext;
const stubBrowser = { __stub: true } as unknown as Browser;

async function run(script: string) {
  return runPlaywrightScript({
    script,
    page: stubPage,
    context: stubContext,
    browser: stubBrowser,
  });
}

describe('sandbox security boundary', () => {
  it('exposes page/context/browser/console/fetch globals', async () => {
    const r = await run(`
      console.log('hi', page.url());
      return { ok: true, ctxStub: context.__stub, brStub: browser.__stub, hasFetch: typeof fetch === 'function' };
    `);
    expect(r.ok).toBe(true);
    expect(r.returnValue).toEqual({ ok: true, ctxStub: true, brStub: true, hasFetch: true });
    expect(r.consoleMessages.length).toBe(1);
    expect(r.consoleMessages[0].level).toBe('log');
  });

  it('blocks process access', async () => {
    const r = await run(`return typeof process;`);
    expect(r.ok).toBe(true);
    expect(r.returnValue).toBe('undefined');
  });

  it('blocks require()', async () => {
    const r = await run(`return typeof require;`);
    expect(r.ok).toBe(true);
    expect(r.returnValue).toBe('undefined');
  });

  it('blocks dynamic import', async () => {
    // `import` is a keyword at parse time inside dynamic position only as a
    // call expression; in our sandbox it's not bound, so this should be a
    // ReferenceError or undefined depending on how the engine treats it.
    const r = await run(`
      try {
        const _ = await import('node:fs');
        return 'leaked';
      } catch (e) {
        return 'blocked';
      }
    `);
    expect(r.returnValue).toBe('blocked');
  });

  it('captures multiple console levels', async () => {
    const r = await run(`
      console.log('l');
      console.info('i');
      console.warn('w');
      console.error('e');
      console.debug('d');
      return true;
    `);
    expect(r.consoleMessages.map((m) => m.level)).toEqual([
      'log',
      'info',
      'warn',
      'error',
      'debug',
    ]);
  });

  it('returns ok:false with error name+message on throw', async () => {
    const r = await run(`throw new TypeError('boom');`);
    expect(r.ok).toBe(false);
    expect(r.error?.name).toBe('TypeError');
    expect(r.error?.message).toBe('boom');
  });

  it('walltime watchdog kills infinite loops within the cap', async () => {
    const r = await runPlaywrightScript({
      script: `while (true) {}`,
      page: stubPage,
      context: stubContext,
      browser: stubBrowser,
      options: { wallTimeMs: 200, cpuKillMs: 5_000 },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/wall-time|Script execution timed out/i);
  });
});
