import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type { networkRequestsSchema } from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function networkRequests(
  args: z.infer<typeof networkRequestsSchema>,
): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    let events = rec.networkHistory;
    if (args.kindFilter && args.kindFilter.length > 0) {
      const set = new Set(args.kindFilter);
      events = events.filter((e) => set.has(e.kind));
    }
    const slice = events.slice(-args.limit);
    return ok({ events: slice, total: rec.networkHistory.length });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`network_requests failed: ${message}`, hint);
  }
}
