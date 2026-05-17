import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type { navigateSchema, interceptRedirectSchema, waitForUrlSchema } from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function navigate(args: z.infer<typeof navigateSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    const response = await rec.page.goto(args.url, {
      waitUntil: args.waitUntil,
      timeout: args.timeoutMs,
    });
    return ok({
      pageId: args.pageId,
      url: rec.page.url(),
      status: response?.status() ?? null,
      ok: response?.ok() ?? null,
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`navigate failed: ${message}`, hint);
  }
}

export async function interceptRedirect(
  args: z.infer<typeof interceptRedirectSchema>,
): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    const pattern = new RegExp(args.urlPattern);
    const matchedUrl = await rec.page
      .waitForURL((url) => pattern.test(url.toString()), { timeout: args.timeoutMs })
      .then(() => rec.page.url());

    const parsed = new URL(matchedUrl);
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    // Fragment can also carry OAuth params (implicit flow).
    const fragmentParams: Record<string, string> = {};
    if (parsed.hash && parsed.hash.startsWith('#')) {
      const fp = new URLSearchParams(parsed.hash.slice(1));
      fp.forEach((v, k) => {
        fragmentParams[k] = v;
      });
    }
    return ok({
      matched: true,
      url: matchedUrl,
      query,
      fragment: fragmentParams,
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`intercept_redirect failed: ${message}`, hint);
  }
}

export async function waitForUrl(args: z.infer<typeof waitForUrlSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    const pattern = new RegExp(args.urlPattern);
    await rec.page.waitForURL((url) => pattern.test(url.toString()), { timeout: args.timeoutMs });
    return ok({ url: rec.page.url() });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`wait_for_url failed: ${message}`, hint);
  }
}
