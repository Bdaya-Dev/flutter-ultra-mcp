import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type { clickSchema, fillSchema, pressKeySchema } from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function click(args: z.infer<typeof clickSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    await rec.page.click(args.selector, {
      button: args.button,
      clickCount: args.clickCount,
      timeout: args.timeoutMs,
    });
    return ok({ clicked: args.selector });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`click failed: ${message}`, hint);
  }
}

export async function fill(args: z.infer<typeof fillSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    await rec.page.fill(args.selector, args.value, { timeout: args.timeoutMs });
    return ok({ filled: args.selector });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`fill failed: ${message}`, hint);
  }
}

export async function pressKey(args: z.infer<typeof pressKeySchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    await rec.page.keyboard.press(args.key);
    return ok({ pressed: args.key });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`press_key failed: ${message}`, hint);
  }
}
