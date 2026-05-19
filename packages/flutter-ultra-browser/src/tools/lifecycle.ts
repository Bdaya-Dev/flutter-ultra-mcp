import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type {
  launchBrowserSchema,
  connectOverCdpSchema,
  closeBrowserSchema,
  newContextSchema,
  closeContextSchema,
  newTabSchema,
} from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function launchBrowser(
  args: z.infer<typeof launchBrowserSchema>,
): Promise<ToolReturn> {
  try {
    const rec = await browserManager.launchBrowser({
      type: args.type,
      headless: args.headless,
      ...(args.persistProfileDir !== undefined
        ? { persistProfileDir: args.persistProfileDir }
        : {}),
      ...(args.args !== undefined ? { args: args.args } : {}),
      ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    });
    return ok({
      browserId: rec.browserId,
      type: rec.type,
      persistent: rec.persistent,
      startedAt: rec.startedAt,
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(
      `launch_browser failed: ${message}`,
      hint ||
        'Verify Playwright browsers installed: run `npx playwright install chromium` once after npm install.',
    );
  }
}

export async function connectOverCdp(
  args: z.infer<typeof connectOverCdpSchema>,
): Promise<ToolReturn> {
  try {
    const { browserRecord, contexts, pages } = await browserManager.connectOverCDP({
      endpointURL: args.endpointURL,
      timeoutMs: args.timeoutMs,
    });
    return ok({
      browserId: browserRecord.browserId,
      type: browserRecord.type,
      startedAt: browserRecord.startedAt,
      contexts: contexts.map((c) => ({
        contextId: c.contextId,
        pages: pages
          .filter((p) => p.contextId === c.contextId)
          .map((p) => ({ pageId: p.pageId, url: p.page.url() })),
      })),
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(
      `connect_over_cdp failed: ${message}`,
      hint ||
        'Verify the CDP endpoint is reachable and Chrome was launched with --remote-debugging-port.',
    );
  }
}

export async function closeBrowser(args: z.infer<typeof closeBrowserSchema>): Promise<ToolReturn> {
  try {
    await browserManager.closeBrowser(args.browserId);
    return ok({ closed: args.browserId });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`close_browser failed: ${message}`, hint);
  }
}

export async function newContext(args: z.infer<typeof newContextSchema>): Promise<ToolReturn> {
  try {
    const rec = await browserManager.newContext({
      browserId: args.browserId,
      ...(args.viewport !== undefined ? { viewport: args.viewport } : {}),
      ...(args.recordVideo !== undefined
        ? {
            recordVideo: {
              dir: args.recordVideo.dir,
              ...(args.recordVideo.size !== undefined ? { size: args.recordVideo.size } : {}),
            },
          }
        : {}),
    });
    return ok({
      contextId: rec.contextId,
      browserId: rec.browserId,
      ...(rec.recordingDir !== undefined ? { recordingDir: rec.recordingDir } : {}),
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`new_context failed: ${message}`, hint);
  }
}

export async function closeContext(args: z.infer<typeof closeContextSchema>): Promise<ToolReturn> {
  try {
    const result = await browserManager.closeContext(args.contextId);
    return ok({
      closed: args.contextId,
      ...(result.videoPath !== undefined ? { videoPath: result.videoPath } : {}),
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`close_context failed: ${message}`, hint);
  }
}

export async function newTab(args: z.infer<typeof newTabSchema>): Promise<ToolReturn> {
  try {
    const rec = await browserManager.newTab({
      contextId: args.contextId,
      ...(args.url !== undefined ? { url: args.url } : {}),
    });
    return ok({ pageId: rec.pageId, contextId: rec.contextId, url: rec.page.url() });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`new_tab failed: ${message}`, hint);
  }
}
