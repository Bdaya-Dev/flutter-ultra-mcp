import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type { setStorageSchema, getStorageSchema, linkToFlutterSchema } from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function setStorage(args: z.infer<typeof setStorageSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getContext(args.contextId);
    if (args.cookies && args.cookies.length > 0) {
      // Strip undefineds — Playwright's signature uses `?:` not `T | undefined`.
      const cookies = args.cookies.map(
        (c) =>
          Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as unknown as {
            name: string;
            value: string;
          },
      );
      await rec.context.addCookies(cookies);
    }
    if (args.localStorage && args.localStorage.length > 0) {
      for (const entry of args.localStorage) {
        // Use addInitScript so localStorage exists from first page load,
        // then also try to write directly into any open pages.
        const init = `
          try {
            const items = ${JSON.stringify(entry.items)};
            if (location.origin === ${JSON.stringify(entry.origin)}) {
              for (const it of items) localStorage.setItem(it.name, it.value);
            }
          } catch (e) {}
        `;
        await rec.context.addInitScript({ content: init });
      }
    }
    return ok({
      cookiesAdded: args.cookies?.length ?? 0,
      localStorageOrigins: args.localStorage?.length ?? 0,
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`set_storage failed: ${message}`, hint);
  }
}

export async function getStorage(args: z.infer<typeof getStorageSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getContext(args.contextId);
    const state = await rec.context.storageState();
    return ok(state);
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`get_storage failed: ${message}`, hint);
  }
}

export async function linkToFlutter(
  args: z.infer<typeof linkToFlutterSchema>,
): Promise<ToolReturn> {
  try {
    await browserManager.linkToFlutter(args.contextId, args.flutterSessionId);
    return ok({ contextId: args.contextId, flutterSessionId: args.flutterSessionId });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`link_to_flutter failed: ${message}`, hint);
  }
}
