import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type { startTracingSchema, stopTracingSchema } from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function startTracing(args: z.infer<typeof startTracingSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getContext(args.contextId);
    await rec.context.tracing.start({
      screenshots: args.screenshots ?? true,
      snapshots: args.snapshots ?? true,
      sources: args.sources ?? false,
    });
    return ok({ tracing: 'started', contextId: args.contextId });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`start_tracing failed: ${message}`, hint);
  }
}

export async function stopTracing(args: z.infer<typeof stopTracingSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getContext(args.contextId);
    await rec.context.tracing.stop({ path: args.outputPath });
    return ok({ tracing: 'stopped', contextId: args.contextId, outputPath: args.outputPath });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`stop_tracing failed: ${message}`, hint);
  }
}
