import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type {
  consoleLogsSchema,
  startConsoleCaptureSchema,
  getConsoleCaptureSchema,
  stopConsoleCaptureSchema,
} from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function consoleLogs(args: z.infer<typeof consoleLogsSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    const slice = rec.consoleHistory.slice(-args.limit);
    return ok({ events: slice, total: rec.consoleHistory.length });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`console_logs failed: ${message}`, hint);
  }
}

export async function startConsoleCapture(
  args: z.infer<typeof startConsoleCaptureSchema>,
): Promise<ToolReturn> {
  try {
    const cap = browserManager.startConsoleCapture({
      contextId: args.contextId,
      ...(args.levels !== undefined ? { levels: args.levels } : {}),
      ...(args.textPattern !== undefined ? { textPattern: args.textPattern } : {}),
      ...(args.since !== undefined ? { since: args.since } : {}),
    });
    return ok({
      captureId: cap.captureId,
      contextId: cap.contextId,
      startedAt: cap.startedAt,
      attachedPageIds: Array.from(cap.pageIds),
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`start_console_capture failed: ${message}`, hint);
  }
}

export async function getConsoleCapture(
  args: z.infer<typeof getConsoleCaptureSchema>,
): Promise<ToolReturn> {
  try {
    const result = browserManager.getConsoleCapture({
      captureId: args.captureId,
      ...(args.since !== undefined ? { since: args.since } : {}),
      limit: args.limit,
    });
    return ok(result);
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`get_console_capture failed: ${message}`, hint);
  }
}

export async function stopConsoleCapture(
  args: z.infer<typeof stopConsoleCaptureSchema>,
): Promise<ToolReturn> {
  try {
    const result = browserManager.stopConsoleCapture(args.captureId);
    return ok(result);
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`stop_console_capture failed: ${message}`, hint);
  }
}
