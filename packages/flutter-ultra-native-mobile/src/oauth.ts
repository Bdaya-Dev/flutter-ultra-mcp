// CCT OAuth solver — plan §5.5.1.
//
// The Flutter app's deep-link handler cannot distinguish "intent from CCT"
// from "intent from `adb shell am start`". We exploit that: run the OAuth
// flow in Playwright, intercept the redirect to the app scheme, then
// dispatch the same URL into the app via Device.shell() (the abstraction
// today wraps `adb am start` / `simctl openurl` / `idb open`).

import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type * as PlaywrightCoreNs from 'playwright-core';
import type { Browser, BrowserContext, BrowserType, Page } from 'playwright-core';
import { AndroidDevice } from './android.js';
import { IosSimDevice } from './ios.js';
import type { DeviceTransport } from './device.js';

type PlaywrightCore = typeof PlaywrightCoreNs;

export interface SolveOauthOptions {
  device: DeviceTransport;
  authorizeUrl: string;
  redirectUriPattern: string;
  androidPackage?: string;
  fillFlow?: {
    usernameSelector: string;
    username: string;
    passwordSelector: string;
    password: string;
    submitSelector: string;
  };
  persistProfileDir?: string;
  timeoutMs: number;
  headless: boolean;
  signal: AbortSignal;
}

export interface SolveOauthResult {
  matched: boolean;
  fullResponseUrl: string;
  query: Record<string, string>;
  fragment: Record<string, string>;
  // The actual shell verb we used to deliver the URL back to the app, for
  // debugging.
  dispatchedVia: 'adb-am-start' | 'simctl-openurl' | 'unsupported';
  dispatchExitCode: number | null;
  dispatchStderr?: string;
  // True when the agent should pause for human MFA — we surface the page
  // URL/title at the pause point.
  pausedForHuman?: { reason: 'mfa-required'; url: string; title: string };
}

// Import playwright-core dynamically so the dependency isn't loaded
// unless this tool is actually called (helps cold-start). The PlaywrightCore
// type alias at the top of the file gives a static handle without paying
// the runtime cost up front.
function loadPlaywright(): PlaywrightCore {
  const _require = createRequire(import.meta.url);
  return _require('playwright-core') as PlaywrightCore;
}

export async function solveOauthInCustomTab(opts: SolveOauthOptions): Promise<SolveOauthResult> {
  if (opts.signal.aborted) {
    throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error('aborted');
  }
  const pw = loadPlaywright();
  const chromium: BrowserType = pw.chromium;

  let browser: Browser | undefined;
  let context: BrowserContext;
  let page: Page;

  if (opts.persistProfileDir) {
    await mkdir(dirname(opts.persistProfileDir), { recursive: true });
    context = await chromium.launchPersistentContext(opts.persistProfileDir, {
      headless: opts.headless,
    });
    page = context.pages()[0] ?? (await context.newPage());
  } else {
    browser = await chromium.launch({ headless: opts.headless });
    context = await browser.newContext();
    page = await context.newPage();
  }

  // Force navigation cancellation when the agent aborts.
  const onAbort = (): void => {
    page
      .context()
      .close()
      .catch(() => undefined);
    browser?.close().catch(() => undefined);
  };
  opts.signal.addEventListener('abort', onAbort, { once: true });

  const redirectRegex = new RegExp(opts.redirectUriPattern);
  let matchedUrl = '';
  // Page.waitForURL won't fire on a navigation to a non-http scheme that
  // Chromium blocks; we listen on the `frame.url` events directly via
  // `page.on('framenavigated')` which gets the URL even when nav is cancelled.
  const sawRedirect = new Promise<string>((resolve) => {
    const onNav = (frame: { url(): string; parentFrame(): unknown }): void => {
      if (frame.parentFrame()) return;
      const url = frame.url();
      if (redirectRegex.test(url)) {
        matchedUrl = url;
        resolve(url);
      }
    };
    page.on('framenavigated', onNav);
    // Also handle Chromium's "ERR_UNKNOWN_URL_SCHEME" via request events.
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (redirectRegex.test(url)) {
        matchedUrl = url;
        resolve(url);
      }
    });
  });

  try {
    await page.goto(opts.authorizeUrl, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });

    if (opts.fillFlow) {
      try {
        await page.waitForSelector(opts.fillFlow.usernameSelector, { timeout: 15_000 });
        await page.fill(opts.fillFlow.usernameSelector, opts.fillFlow.username);
        await page.fill(opts.fillFlow.passwordSelector, opts.fillFlow.password);
        await page.click(opts.fillFlow.submitSelector);
      } catch (err) {
        // Selector miss usually means the provider's UI changed. Pause
        // for human intervention rather than aborting silently.
        return {
          matched: false,
          fullResponseUrl: page.url(),
          query: {},
          fragment: {},
          dispatchedVia: 'unsupported',
          dispatchExitCode: null,
          pausedForHuman: {
            reason: 'mfa-required',
            url: page.url(),
            title: await page.title().catch(() => ''),
          },
          dispatchStderr: `fillFlow selector failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const finalUrl = await Promise.race([
      sawRedirect,
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `solve_oauth_in_chrome_custom_tab: no redirect matched ${opts.redirectUriPattern} within ${opts.timeoutMs}ms`,
              ),
            ),
          opts.timeoutMs,
        ).unref?.(),
      ),
    ]);

    const parsed = new URL(finalUrl);
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    const fragment: Record<string, string> = {};
    if (parsed.hash && parsed.hash.startsWith('#')) {
      const fp = new URLSearchParams(parsed.hash.slice(1));
      fp.forEach((v, k) => {
        fragment[k] = v;
      });
    }

    let dispatchedVia: SolveOauthResult['dispatchedVia'] = 'unsupported';
    let dispatchExitCode: number | null = null;
    let dispatchStderr: string | undefined;
    if (opts.device instanceof AndroidDevice) {
      const res = await opts.device.dispatchDeepLink(finalUrl, opts.androidPackage);
      dispatchedVia = 'adb-am-start';
      dispatchExitCode = res.exitCode;
      if (!res.ok) dispatchStderr = res.stderr.trim();
    } else if (opts.device instanceof IosSimDevice) {
      const res = await opts.device.openUrl(finalUrl);
      dispatchedVia = 'simctl-openurl';
      dispatchExitCode = res.exitCode;
      if (!res.ok) dispatchStderr = res.stderr.trim();
    } else {
      dispatchStderr =
        'solve_oauth_in_chrome_custom_tab: device kind not supported for dispatch (only Android + iOS Simulator). For physical iOS, install idb and dispatch manually.';
    }

    return {
      matched: true,
      fullResponseUrl: finalUrl,
      query,
      fragment,
      dispatchedVia,
      dispatchExitCode,
      ...(dispatchStderr !== undefined ? { dispatchStderr } : {}),
    };
  } finally {
    opts.signal.removeEventListener('abort', onAbort);
    try {
      if (opts.persistProfileDir) {
        await context.close();
      } else {
        await browser?.close();
      }
    } catch {
      // best-effort
    }
    // ensure matched used (lints clean)
    void matchedUrl;
  }
}
