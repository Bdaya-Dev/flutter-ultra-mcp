// In-process registry of Playwright browsers, contexts, pages, and console
// captures. Each MCP server process owns its own browser tree; cross-process
// state (link_to_flutter mappings, captureIds visible to other servers) is
// projected to state files via @ref state.ts.

import type { Browser, BrowserContext, Page, BrowserType, ConsoleMessage } from 'playwright-core';
import type * as PlaywrightCoreNs from 'playwright-core';
import { log } from './logger.js';
import { shortId } from './ids.js';
import { stateAppendJsonl, stateWrite } from './state.js';

type PlaywrightCore = typeof PlaywrightCoreNs;

export type SupportedBrowser = 'chromium' | 'firefox' | 'webkit';

export interface BrowserRecord {
  browserId: string;
  type: SupportedBrowser;
  browser: Browser;
  persistent: boolean;
  startedAt: string;
}

export interface ContextRecord {
  contextId: string;
  browserId: string;
  context: BrowserContext;
  flutterSessionId?: string;
}

export interface PageRecord {
  pageId: string;
  contextId: string;
  page: Page;
  consoleHistory: ConsoleEvent[]; // bounded; for one-shot console_logs
  networkHistory: NetworkEvent[]; // bounded
}

export type ConsoleLevel =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'debug'
  | 'verbose'
  | 'pageerror'
  | 'crash';

export interface ConsoleEvent {
  ts: string;
  level: ConsoleLevel;
  text: string;
  location?: { url: string; lineNumber: number; columnNumber: number };
  args?: unknown[];
  url?: string; // page URL at event time
}

export interface NetworkEvent {
  ts: string;
  kind: 'request' | 'response' | 'requestfailed';
  method?: string;
  url: string;
  status?: number;
  resourceType?: string;
  failureText?: string;
}

export interface ConsoleCapture {
  captureId: string;
  pageIds: Set<string>;
  contextId: string;
  filters?: {
    levels?: ConsoleLevel[];
    textPattern?: RegExp;
    since?: number; // ms epoch
  };
  buffer: ConsoleEvent[]; // also mirrored to state/captures/console-<id>.jsonl
  startedAt: string;
  truncated: boolean;
  // Listeners we installed; key is pageId so we can detach on stop.
  listeners: Map<string, Array<() => void>>;
}

const CONSOLE_HISTORY_CAP = 500;
const NETWORK_HISTORY_CAP = 1_000;
const CAPTURE_BUFFER_CAP = 10_000;

export class BrowserManager {
  private browsers = new Map<string, BrowserRecord>();
  private contexts = new Map<string, ContextRecord>();
  private pages = new Map<string, PageRecord>();
  private captures = new Map<string, ConsoleCapture>();
  private playwrightCache?: PlaywrightCore;

  async getPlaywright(): Promise<PlaywrightCore> {
    if (!this.playwrightCache) {
      // Dynamic import keeps Playwright off the cold-start path until the
      // first browser tool is called (per plan §17.0 keep-alive concerns).
      this.playwrightCache = await import('playwright-core');
    }
    return this.playwrightCache;
  }

  async launchBrowser(args: {
    type?: SupportedBrowser;
    headless?: boolean;
    persistProfileDir?: string;
    args?: string[];
    timeoutMs?: number;
  }): Promise<BrowserRecord> {
    const pw = await this.getPlaywright();
    const type: SupportedBrowser = args.type ?? 'chromium';
    const bt: BrowserType = pw[type];
    const headless = args.headless ?? true;
    const launchOpts: Parameters<BrowserType['launch']>[0] = {
      headless,
      timeout: args.timeoutMs ?? 60_000,
      ...(args.args !== undefined ? { args: args.args } : {}),
    };

    let browser: Browser;
    let persistent = false;
    let primaryContext: BrowserContext | undefined;
    if (args.persistProfileDir) {
      persistent = true;
      const ctx = await bt.launchPersistentContext(args.persistProfileDir, launchOpts);
      browser = ctx.browser()!;
      primaryContext = ctx;
    } else {
      browser = await bt.launch(launchOpts);
    }

    const browserId = shortId('br');
    const record: BrowserRecord = {
      browserId,
      type,
      browser,
      persistent,
      startedAt: new Date().toISOString(),
    };
    this.browsers.set(browserId, record);

    browser.on('disconnected', () => {
      log.info('browser_disconnected', { browserId });
      this.browsers.delete(browserId);
    });

    if (primaryContext) {
      // Persistent context exposes a default context; register it.
      this.registerContext(browserId, primaryContext);
    }

    await this.projectBrowsersState();
    log.info('browser_launched', { browserId, type, headless, persistent });
    return record;
  }

  async closeBrowser(browserId: string): Promise<void> {
    const rec = this.browsers.get(browserId);
    if (!rec) throw new Error(`Browser ${browserId} not found`);
    for (const [cid, ctx] of this.contexts) {
      if (ctx.browserId === browserId) {
        await this.closeContextInternal(cid).catch((e) =>
          log.warn('ctx_close_failed', { contextId: cid, err: (e as Error).message }),
        );
      }
    }
    await rec.browser
      .close()
      .catch((e) => log.warn('browser_close_failed', { browserId, err: (e as Error).message }));
    this.browsers.delete(browserId);
    await this.projectBrowsersState();
    log.info('browser_closed', { browserId });
  }

  async newContext(args: {
    browserId: string;
    viewport?: { width: number; height: number };
  }): Promise<ContextRecord> {
    const rec = this.browsers.get(args.browserId);
    if (!rec) throw new Error(`Browser ${args.browserId} not found`);
    if (rec.persistent) {
      throw new Error(
        `Browser ${args.browserId} is persistent (launched with persistProfileDir). Persistent browsers expose a single context; use that one instead.`,
      );
    }
    const ctx = await rec.browser.newContext(args.viewport ? { viewport: args.viewport } : {});
    return this.registerContext(args.browserId, ctx);
  }

  private registerContext(browserId: string, ctx: BrowserContext): ContextRecord {
    const contextId = shortId('ctx');
    const record: ContextRecord = { contextId, browserId, context: ctx };
    this.contexts.set(contextId, record);
    ctx.on('close', () => {
      log.info('context_closed', { contextId });
      this.contexts.delete(contextId);
    });
    return record;
  }

  async closeContext(contextId: string): Promise<void> {
    await this.closeContextInternal(contextId);
  }

  private async closeContextInternal(contextId: string): Promise<void> {
    const rec = this.contexts.get(contextId);
    if (!rec) return;
    // Pages inside this context will close with it; remove our records.
    for (const [pid, p] of this.pages) {
      if (p.contextId === contextId) this.pages.delete(pid);
    }
    // Stop captures bound only to this context.
    for (const [cap, capture] of this.captures) {
      if (capture.contextId === contextId) {
        this.detachCaptureListeners(capture);
        this.captures.delete(cap);
      }
    }
    await rec.context.close().catch(() => {
      /* already closing */
    });
    this.contexts.delete(contextId);
  }

  async newTab(args: { contextId: string; url?: string }): Promise<PageRecord> {
    const ctxRec = this.contexts.get(args.contextId);
    if (!ctxRec) throw new Error(`Context ${args.contextId} not found`);
    const page = await ctxRec.context.newPage();
    if (args.url) await page.goto(args.url);
    return this.registerPage(args.contextId, page);
  }

  private registerPage(contextId: string, page: Page): PageRecord {
    const pageId = shortId('pg');
    const record: PageRecord = {
      pageId,
      contextId,
      page,
      consoleHistory: [],
      networkHistory: [],
    };
    this.pages.set(pageId, record);

    // Bounded console history (one-shot console_logs path).
    page.on('console', (msg: ConsoleMessage) => {
      const ev: ConsoleEvent = {
        ts: new Date().toISOString(),
        level: normalizeLevel(msg.type()),
        text: msg.text(),
        location: msg.location(),
        url: page.url(),
      };
      record.consoleHistory.push(ev);
      if (record.consoleHistory.length > CONSOLE_HISTORY_CAP) {
        record.consoleHistory.splice(0, record.consoleHistory.length - CONSOLE_HISTORY_CAP);
      }
    });
    page.on('pageerror', (err) => {
      const ev: ConsoleEvent = {
        ts: new Date().toISOString(),
        level: 'pageerror',
        text: err.message,
        url: page.url(),
      };
      record.consoleHistory.push(ev);
      if (record.consoleHistory.length > CONSOLE_HISTORY_CAP) {
        record.consoleHistory.splice(0, record.consoleHistory.length - CONSOLE_HISTORY_CAP);
      }
    });
    page.on('crash', () => {
      const ev: ConsoleEvent = {
        ts: new Date().toISOString(),
        level: 'crash',
        text: '<page crashed>',
        url: page.url(),
      };
      record.consoleHistory.push(ev);
    });

    page.on('request', (req) => {
      record.networkHistory.push({
        ts: new Date().toISOString(),
        kind: 'request',
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
      });
      if (record.networkHistory.length > NETWORK_HISTORY_CAP) {
        record.networkHistory.splice(0, record.networkHistory.length - NETWORK_HISTORY_CAP);
      }
    });
    page.on('response', (res) => {
      record.networkHistory.push({
        ts: new Date().toISOString(),
        kind: 'response',
        method: res.request().method(),
        url: res.url(),
        status: res.status(),
      });
      if (record.networkHistory.length > NETWORK_HISTORY_CAP) {
        record.networkHistory.splice(0, record.networkHistory.length - NETWORK_HISTORY_CAP);
      }
    });
    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText;
      record.networkHistory.push({
        ts: new Date().toISOString(),
        kind: 'requestfailed',
        method: req.method(),
        url: req.url(),
        ...(failure !== undefined ? { failureText: failure } : {}),
      });
    });

    // If any console capture is active in this context, retroactively wire it
    // to this new page — covers `navigate()`-spawned new pages and survives
    // popups (AC-Br4).
    for (const capture of this.captures.values()) {
      if (capture.contextId === contextId) {
        this.wireCaptureToPage(capture, record);
      }
    }

    page.on('close', () => {
      log.debug('page_closed', { pageId });
      this.pages.delete(pageId);
      for (const cap of this.captures.values()) {
        cap.pageIds.delete(pageId);
        cap.listeners.delete(pageId);
      }
    });
    return record;
  }

  getBrowser(id: string): BrowserRecord {
    const r = this.browsers.get(id);
    if (!r) throw new Error(`Browser ${id} not found`);
    return r;
  }
  getContext(id: string): ContextRecord {
    const r = this.contexts.get(id);
    if (!r) throw new Error(`Context ${id} not found`);
    return r;
  }
  getPage(id: string): PageRecord {
    const r = this.pages.get(id);
    if (!r) throw new Error(`Page ${id} not found`);
    return r;
  }

  listBrowsers(): BrowserRecord[] {
    return Array.from(this.browsers.values());
  }
  listContexts(): ContextRecord[] {
    return Array.from(this.contexts.values());
  }
  listPages(): PageRecord[] {
    return Array.from(this.pages.values());
  }

  // -------- Console captures (rev-23 split-tool, AC-Br4) --------

  startConsoleCapture(args: {
    contextId: string;
    levels?: ConsoleLevel[];
    textPattern?: string;
    since?: string;
  }): ConsoleCapture {
    const ctxRec = this.contexts.get(args.contextId);
    if (!ctxRec) throw new Error(`Context ${args.contextId} not found`);

    const captureId = shortId('cap');
    const capture: ConsoleCapture = {
      captureId,
      contextId: args.contextId,
      pageIds: new Set(),
      filters: {
        ...(args.levels && args.levels.length > 0 ? { levels: args.levels } : {}),
        ...(args.textPattern ? { textPattern: new RegExp(args.textPattern) } : {}),
        ...(args.since ? { since: Date.parse(args.since) } : {}),
      },
      buffer: [],
      startedAt: new Date().toISOString(),
      truncated: false,
      listeners: new Map(),
    };
    this.captures.set(captureId, capture);

    // Wire to every existing page in this context.
    for (const p of this.pages.values()) {
      if (p.contextId === args.contextId) {
        this.wireCaptureToPage(capture, p);
      }
    }

    // Future pages opened in this context get wired via registerPage above.
    log.info('console_capture_started', { captureId, contextId: args.contextId });
    return capture;
  }

  private wireCaptureToPage(capture: ConsoleCapture, pageRec: PageRecord): void {
    const { page, pageId } = pageRec;
    const detachers: Array<() => void> = [];

    const onConsole = (msg: ConsoleMessage) => {
      const ev: ConsoleEvent = {
        ts: new Date().toISOString(),
        level: normalizeLevel(msg.type()),
        text: msg.text(),
        location: msg.location(),
        url: page.url(),
      };
      this.recordCaptureEvent(capture, ev);
    };
    const onPageError = (err: Error) => {
      this.recordCaptureEvent(capture, {
        ts: new Date().toISOString(),
        level: 'pageerror',
        text: err.message,
        url: page.url(),
      });
    };
    const onCrash = () => {
      this.recordCaptureEvent(capture, {
        ts: new Date().toISOString(),
        level: 'crash',
        text: '<page crashed>',
        url: page.url(),
      });
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('crash', onCrash);
    detachers.push(
      () => page.off('console', onConsole),
      () => page.off('pageerror', onPageError),
      () => page.off('crash', onCrash),
    );

    capture.pageIds.add(pageId);
    capture.listeners.set(pageId, detachers);
  }

  private recordCaptureEvent(capture: ConsoleCapture, ev: ConsoleEvent): void {
    const f = capture.filters;
    if (f) {
      if (f.since && Date.parse(ev.ts) < f.since) return;
      if (f.levels && !f.levels.includes(ev.level)) return;
      if (f.textPattern && !f.textPattern.test(ev.text)) return;
    }
    capture.buffer.push(ev);
    // Persist to JSONL for cross-restart durability (plan §5.4 impl note).
    stateAppendJsonl(`captures/console-${capture.captureId}.jsonl`, ev).catch((e) =>
      log.warn('capture_append_failed', {
        captureId: capture.captureId,
        err: (e as Error).message,
      }),
    );
    if (capture.buffer.length > CAPTURE_BUFFER_CAP) {
      capture.buffer.splice(0, capture.buffer.length - CAPTURE_BUFFER_CAP);
      capture.truncated = true;
    }
  }

  getConsoleCapture(args: {
    captureId: string;
    since?: number; // cursor: index into buffer
    limit?: number;
  }): { events: ConsoleEvent[]; nextCursor: number; truncated: boolean; total: number } {
    const capture = this.captures.get(args.captureId);
    if (!capture) throw new Error(`Capture ${args.captureId} not found`);
    const since = Math.max(0, args.since ?? 0);
    const limit = Math.max(1, Math.min(args.limit ?? 500, 5_000));
    const slice = capture.buffer.slice(since, since + limit);
    return {
      events: slice,
      nextCursor: since + slice.length,
      truncated: capture.truncated,
      total: capture.buffer.length,
    };
  }

  stopConsoleCapture(captureId: string): {
    captureId: string;
    events: ConsoleEvent[];
    truncated: boolean;
  } {
    const capture = this.captures.get(captureId);
    if (!capture) throw new Error(`Capture ${captureId} not found`);
    this.detachCaptureListeners(capture);
    const events = capture.buffer;
    this.captures.delete(captureId);
    log.info('console_capture_stopped', { captureId, count: events.length });
    return { captureId, events, truncated: capture.truncated };
  }

  private detachCaptureListeners(capture: ConsoleCapture): void {
    for (const detachers of capture.listeners.values()) {
      for (const d of detachers) d();
    }
    capture.listeners.clear();
    capture.pageIds.clear();
  }

  async linkToFlutter(contextId: string, flutterSessionId: string): Promise<void> {
    const rec = this.contexts.get(contextId);
    if (!rec) throw new Error(`Context ${contextId} not found`);
    rec.flutterSessionId = flutterSessionId;
    await this.projectBrowsersState();
  }

  private async projectBrowsersState(): Promise<void> {
    type StateShape = {
      browsers: Array<{
        browserId: string;
        type: SupportedBrowser;
        persistent: boolean;
        startedAt: string;
        contexts: Array<{ contextId: string; flutterSessionId?: string; pageCount: number }>;
      }>;
    };
    const snapshot: StateShape = {
      browsers: this.listBrowsers().map((b) => ({
        browserId: b.browserId,
        type: b.type,
        persistent: b.persistent,
        startedAt: b.startedAt,
        contexts: this.listContexts()
          .filter((c) => c.browserId === b.browserId)
          .map((c) => ({
            contextId: c.contextId,
            ...(c.flutterSessionId ? { flutterSessionId: c.flutterSessionId } : {}),
            pageCount: this.listPages().filter((p) => p.contextId === c.contextId).length,
          })),
      })),
    };
    await stateWrite<StateShape>('browsers.json', () => snapshot, { browsers: [] }).catch((e) =>
      log.warn('browsers_state_write_failed', { err: (e as Error).message }),
    );
  }

  async shutdownAll(): Promise<void> {
    for (const cap of this.captures.values()) this.detachCaptureListeners(cap);
    this.captures.clear();
    for (const id of [...this.browsers.keys()]) {
      await this.closeBrowser(id).catch((e) =>
        log.warn('shutdown_browser_close_failed', { browserId: id, err: (e as Error).message }),
      );
    }
  }
}

function normalizeLevel(playwrightType: string): ConsoleLevel {
  // Playwright console types: 'log','debug','info','error','warning','dir','dirxml','table',
  // 'trace','clear','startGroup','startGroupCollapsed','endGroup','assert','profile','profileEnd','count','timeEnd'.
  switch (playwrightType) {
    case 'log':
    case 'info':
    case 'debug':
    case 'error':
      return playwrightType;
    case 'warning':
      return 'warn';
    default:
      return 'log';
  }
}

export const browserManager = new BrowserManager();
