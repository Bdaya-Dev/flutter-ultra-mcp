import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type { screenshotSchema } from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { image, fail, tryFormatError } from '../result.js';

export async function screenshot(args: z.infer<typeof screenshotSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    let buf: Buffer;
    if (args.selector) {
      const locator = rec.page.locator(args.selector);
      buf = await locator.screenshot({
        timeout: args.timeoutMs,
        omitBackground: args.omitBackground,
      });
    } else {
      buf = await rec.page.screenshot({
        fullPage: args.fullPage,
        omitBackground: args.omitBackground,
        timeout: args.timeoutMs,
      });
    }
    const alt = `${args.fullPage ? 'full-page ' : ''}screenshot of ${args.selector ?? rec.page.url()}`;
    return image(buf.toString('base64'), alt);
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`screenshot failed: ${message}`, hint);
  }
}
