import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type { dragSchema, dropFilesSchema } from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function drag(args: z.infer<typeof dragSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    await rec.page.dragAndDrop(args.source, args.target, {
      timeout: args.timeoutMs,
      ...(args.sourcePosition !== undefined ? { sourcePosition: args.sourcePosition } : {}),
      ...(args.targetPosition !== undefined ? { targetPosition: args.targetPosition } : {}),
    });
    return ok({ dragged: args.source, droppedOn: args.target });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`drag failed: ${message}`, hint);
  }
}

export async function dropFiles(args: z.infer<typeof dropFilesSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    const locator = rec.page.locator(args.selector);
    await locator.setInputFiles(args.files, { timeout: args.timeoutMs });
    return ok({ droppedFiles: args.files, onto: args.selector });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`drop_files failed: ${message}`, hint);
  }
}
