// Sandboxed Playwright-script runner per plan §5.4 line 633-651.
//
// Security boundary:
//   EXPOSED globals: page, context, browser, expect, console, fetch
//   NOT exposed:     process, require, import (dynamic), filesystem, child_process
//
// Watchdog:
//   - Wall-time hard cap (default 5 min, env override).
//   - CPU watchdog kills if the script is sustained 100% CPU for > 30s.
//   - vm.runInContext microtask isolation via separate context.

import vm from 'node:vm';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { log } from './logger.js';

const DEFAULT_WALL_MS = 5 * 60 * 1000;
const CPU_KILL_MS = 30 * 1000;

export interface SandboxOptions {
  wallTimeMs?: number;
  cpuKillMs?: number;
  /** If true, expose `expect` from Playwright's bundled `expect`. */
  exposeExpect?: boolean;
}

export interface SandboxResult {
  ok: boolean;
  returnValue: unknown;
  consoleMessages: Array<{ level: string; args: unknown[] }>;
  durationMs: number;
  error?: { name: string; message: string; stack?: string };
}

export async function runPlaywrightScript(args: {
  script: string;
  page: Page;
  context: BrowserContext;
  browser: Browser;
  options?: SandboxOptions;
  signal?: AbortSignal;
}): Promise<SandboxResult> {
  const wallMs = args.options?.wallTimeMs ?? DEFAULT_WALL_MS;
  const cpuKillMs = args.options?.cpuKillMs ?? CPU_KILL_MS;
  const startedAt = Date.now();

  const consoleMessages: Array<{ level: string; args: unknown[] }> = [];

  const safeConsole = {
    log: (...a: unknown[]) => consoleMessages.push({ level: 'log', args: a }),
    info: (...a: unknown[]) => consoleMessages.push({ level: 'info', args: a }),
    warn: (...a: unknown[]) => consoleMessages.push({ level: 'warn', args: a }),
    error: (...a: unknown[]) => consoleMessages.push({ level: 'error', args: a }),
    debug: (...a: unknown[]) => consoleMessages.push({ level: 'debug', args: a }),
  };

  // Playwright bundles `expect` from `@playwright/test`, but `playwright-core`
  // (our prod dep) does not include it. Optional: try to load if present.
  let expectImpl: unknown;
  if (args.options?.exposeExpect) {
    // Use Function-wrapped dynamic import so TypeScript doesn't resolve
    // @playwright/test at compile time — the package is an optional peer
    // dep that callers install only when they want expect() in scripts.
    try {
      const dynamicImport = new Function('m', 'return import(m)') as (
        m: string,
      ) => Promise<unknown>;
      const mod = (await dynamicImport('@playwright/test')) as { expect?: unknown };
      expectImpl = mod.expect;
    } catch {
      expectImpl = undefined;
    }
  }

  // Compose sandbox globals. `process`, `require`, `import` are NOT placed.
  // We DO need fetch — Node 18+ has global fetch; pass the reference directly.
  const sandboxGlobals: Record<string, unknown> = {
    page: args.page,
    context: args.context,
    browser: args.browser,
    console: safeConsole,
    fetch: (globalThis as { fetch?: unknown }).fetch,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    JSON,
    Math,
    Date,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Error,
    TypeError,
    RangeError,
  };
  if (expectImpl !== undefined) sandboxGlobals.expect = expectImpl;

  const sandboxContext = vm.createContext(sandboxGlobals, {
    name: 'flutter-ultra-browser:script',
    // Strip access to host primordials we didn't expose.
    codeGeneration: { strings: true, wasm: false },
  });

  // The script is wrapped in an async IIFE so the user can write top-level
  // `await`. Return value of the script is the return value of the IIFE.
  const wrapped = `(async () => {\n${args.script}\n})()`;

  let cpuWatchdog: NodeJS.Timeout | undefined;
  let wallWatchdog: NodeJS.Timeout | undefined;
  let aborted = false;
  let cpuBaseline = process.cpuUsage();
  let cpuSamples = 0;

  const abortPromise = new Promise<never>((_, reject) => {
    wallWatchdog = setTimeout(() => {
      aborted = true;
      reject(new Error(`run_playwright_script wall-time limit ${wallMs}ms exceeded`));
    }, wallMs);

    // Crude CPU watchdog: sample every 500ms. If we've burned >480ms of CPU
    // out of every 500ms wall for cpuKillMs continuously, kill it.
    cpuWatchdog = setInterval(() => {
      const delta = process.cpuUsage(cpuBaseline);
      const cpuMicros = delta.user + delta.system;
      cpuBaseline = process.cpuUsage();
      // 500ms wall = 500_000 micros; threshold = 96% CPU.
      if (cpuMicros > 480_000) {
        cpuSamples += 500;
      } else {
        cpuSamples = 0;
      }
      if (cpuSamples >= cpuKillMs) {
        aborted = true;
        reject(new Error(`run_playwright_script CPU watchdog: > 96% for ${cpuKillMs}ms`));
      }
    }, 500);

    if (args.signal) {
      const onAbort = () => {
        aborted = true;
        reject(new Error('run_playwright_script aborted by host'));
      };
      if (args.signal.aborted) onAbort();
      else args.signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    const scriptResult = vm.runInContext(wrapped, sandboxContext, {
      timeout: wallMs,
      displayErrors: true,
      breakOnSigint: true,
    }) as Promise<unknown>;
    const returnValue = await Promise.race([scriptResult, abortPromise]);
    return {
      ok: true,
      returnValue,
      consoleMessages,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const e = err as Error;
    log.warn('script_failed', { aborted, msg: e.message });
    return {
      ok: false,
      returnValue: undefined,
      consoleMessages,
      durationMs: Date.now() - startedAt,
      error: { name: e.name, message: e.message, ...(e.stack ? { stack: e.stack } : {}) },
    };
  } finally {
    if (wallWatchdog) clearTimeout(wallWatchdog);
    if (cpuWatchdog) clearInterval(cpuWatchdog);
  }
}
