// BrowserManager unit tests for the console-capture state machine.
// AC-Br4 fixture: console.log + console.error + pageerror events arriving at
// the manager's capture wire-up must all surface in get_console_capture with
// correct level/text/timestamp, AND the capture must survive a navigation
// (modeled here as removing the old page and registering a new one in the
// same context — which is exactly how Playwright fires events: same page
// instance, page.url() changes after goto).

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserContext, Page } from 'playwright-core';
import { BrowserManager, type ConsoleCapture } from './browserManager.js';

// Minimal Page stub that emits Playwright-shape events.
class FakePage extends EventEmitter {
  private _url: string;
  constructor(url: string) {
    super();
    this._url = url;
  }
  url(): string {
    return this._url;
  }
  setUrl(url: string): void {
    this._url = url;
  }
  // .off is already on EventEmitter; Playwright uses .off too.
  // .on is already on EventEmitter.
  emitConsole(level: string, text: string): void {
    this.emit('console', {
      type: () => level,
      text: () => text,
      location: () => ({ url: this._url, lineNumber: 0, columnNumber: 0 }),
    });
  }
  emitPageError(message: string): void {
    this.emit('pageerror', new Error(message));
  }
  emitCrash(): void {
    this.emit('crash');
  }
}

class FakeContext extends EventEmitter {}

function makeManagerWithContext(): {
  mgr: BrowserManager;
  ctxId: string;
  registerNewPage: (url: string) => { pageId: string; page: FakePage };
} {
  const mgr = new BrowserManager();
  const ctxRec = {
    contextId: 'ctx_test',
    browserId: 'br_test',
    context: new FakeContext() as unknown as BrowserContext,
  };
  // Reach in: a real test would go through launchBrowser+newContext, but
  // those require Playwright. We're testing the capture state machine, not
  // Playwright integration — direct injection is appropriate here.
  (mgr as unknown as { contexts: Map<string, typeof ctxRec> }).contexts.set('ctx_test', ctxRec);

  const registerNewPage = (url: string) => {
    const fp = new FakePage(url);
    const rec = (
      mgr as unknown as {
        registerPage: (cid: string, p: unknown) => { pageId: string };
      }
    ).registerPage('ctx_test', fp as unknown as Page);
    return { pageId: rec.pageId, page: fp };
  };
  return { mgr, ctxId: 'ctx_test', registerNewPage };
}

describe('console capture (AC-Br4)', () => {
  let setup: ReturnType<typeof makeManagerWithContext>;

  beforeEach(() => {
    setup = makeManagerWithContext();
  });

  it('captures console.log + console.error + pageerror with correct level/text', () => {
    const { mgr, ctxId, registerNewPage } = setup;
    const { page } = registerNewPage('https://app.example/route1');
    const capture: ConsoleCapture = mgr.startConsoleCapture({ contextId: ctxId });

    page.emitConsole('log', 'NCRDIAG-MARKER');
    page.emitPageError('boom');
    page.emitConsole('error', 'render failed');

    const got = mgr.getConsoleCapture({ captureId: capture.captureId });
    expect(got.events).toHaveLength(3);
    const levels = got.events.map((e) => e.level);
    expect(levels).toEqual(['log', 'pageerror', 'error']);
    expect(got.events[0].text).toBe('NCRDIAG-MARKER');
    expect(got.events[1].text).toBe('boom');
    for (const ev of got.events) {
      expect(new Date(ev.ts).toString()).not.toBe('Invalid Date');
      expect(ev.url).toBe('https://app.example/route1');
    }
  });

  it('survives navigation in the same context (URL changes mid-capture)', () => {
    const { mgr, ctxId, registerNewPage } = setup;
    const { page } = registerNewPage('https://app.example/route1');
    const capture = mgr.startConsoleCapture({ contextId: ctxId });

    page.emitConsole('log', 'pre-nav');
    // Simulate page.goto by mutating the page URL; Playwright reuses the
    // same Page instance, so listeners remain attached.
    page.setUrl('https://app.example/route2');
    page.emitConsole('log', 'post-nav');

    const got = mgr.getConsoleCapture({ captureId: capture.captureId });
    expect(got.events).toHaveLength(2);
    expect(got.events[0].url).toBe('https://app.example/route1');
    expect(got.events[1].url).toBe('https://app.example/route2');
  });

  it('attaches to NEW pages opened in the context after capture start', () => {
    const { mgr, ctxId, registerNewPage } = setup;
    const capture = mgr.startConsoleCapture({ contextId: ctxId });

    // First page opens AFTER start_console_capture.
    // Playwright emits 'warning' for console.warn — normalizeLevel maps it to 'warn'.
    const { page } = registerNewPage('https://app.example/route1');
    page.emitConsole('warning', 'late page');

    const got = mgr.getConsoleCapture({ captureId: capture.captureId });
    expect(got.events).toHaveLength(1);
    expect(got.events[0].level).toBe('warn');
    expect(got.events[0].text).toBe('late page');
  });

  it('filters by level and textPattern', () => {
    const { mgr, ctxId, registerNewPage } = setup;
    const { page } = registerNewPage('https://app.example/');
    const capture = mgr.startConsoleCapture({
      contextId: ctxId,
      levels: ['error', 'pageerror'],
      textPattern: 'FATAL',
    });
    page.emitConsole('log', 'FATAL but level wrong');
    page.emitConsole('error', 'normal error');
    page.emitConsole('error', 'FATAL match');
    page.emitPageError('FATAL pageerror match');

    const got = mgr.getConsoleCapture({ captureId: capture.captureId });
    expect(got.events.map((e) => e.text)).toEqual(['FATAL match', 'FATAL pageerror match']);
  });

  it('cursor pagination across get_console_capture calls', () => {
    const { mgr, ctxId, registerNewPage } = setup;
    const { page } = registerNewPage('https://app.example/');
    const capture = mgr.startConsoleCapture({ contextId: ctxId });
    for (let i = 0; i < 5; i++) page.emitConsole('log', `msg-${i}`);

    const first = mgr.getConsoleCapture({ captureId: capture.captureId, limit: 2 });
    expect(first.events.map((e) => e.text)).toEqual(['msg-0', 'msg-1']);
    expect(first.nextCursor).toBe(2);

    const second = mgr.getConsoleCapture({
      captureId: capture.captureId,
      since: first.nextCursor,
      limit: 100,
    });
    expect(second.events.map((e) => e.text)).toEqual(['msg-2', 'msg-3', 'msg-4']);
    expect(second.nextCursor).toBe(5);
  });

  it('stop_console_capture detaches listeners; subsequent events not buffered', () => {
    const { mgr, ctxId, registerNewPage } = setup;
    const { page } = registerNewPage('https://app.example/');
    const capture = mgr.startConsoleCapture({ contextId: ctxId });
    page.emitConsole('log', 'before stop');
    const stopped = mgr.stopConsoleCapture(capture.captureId);
    expect(stopped.events).toHaveLength(1);

    page.emitConsole('log', 'after stop');
    expect(() => mgr.getConsoleCapture({ captureId: capture.captureId })).toThrow(/not found/);
  });

  it('captures within 100ms of emission (AC-Br4 latency contract)', () => {
    // Pure-sync proof: the buffer is updated in the same tick as page.emit.
    const { mgr, ctxId, registerNewPage } = setup;
    const { page } = registerNewPage('https://app.example/');
    const capture = mgr.startConsoleCapture({ contextId: ctxId });
    const t0 = Date.now();
    page.emitConsole('log', 'NCRDIAG-MARKER');
    const got = mgr.getConsoleCapture({ captureId: capture.captureId });
    const latencyMs = Date.now() - t0;
    expect(got.events).toHaveLength(1);
    expect(got.events[0].text).toBe('NCRDIAG-MARKER');
    expect(latencyMs).toBeLessThan(100);
  });
});
