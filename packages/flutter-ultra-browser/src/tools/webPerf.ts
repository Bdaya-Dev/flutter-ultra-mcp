// Web performance tools — CDP-based metrics and heap snapshot.
//
// get_web_perf_metrics: reads Performance.getMetrics via CDP and navigation
//   timing from window.performance.getEntriesByType('navigation').
// take_heap_snapshot: captures a V8 heap snapshot via HeapProfiler CDP domain.

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type { getWebPerfMetricsSchema, takeHeapSnapshotSchema } from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function getWebPerfMetrics(
  args: z.infer<typeof getWebPerfMetricsSchema>,
): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    const client = await rec.page.context().newCDPSession(rec.page);

    try {
      // Enable Performance domain first (no-op if already enabled).
      await client.send('Performance.enable', { timeDomain: 'timeTicks' });

      const { metrics } = await client.send('Performance.getMetrics');

      // Also pull navigation timing from the page itself for richer data.
      // Cast through unknown to avoid DOM lib type mismatches in the evaluate
      // callback — Playwright serialises the result as plain JSON anyway.
      const navEntries = await rec.page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entries = (performance as any).getEntriesByType('navigation') as any[];
        return entries.map((nav: any) => ({
          name: nav.name,
          startTime: nav.startTime,
          duration: nav.duration,
          domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
          loadEventEnd: nav.loadEventEnd,
          transferSize: nav.transferSize,
          encodedBodySize: nav.encodedBodySize,
          decodedBodySize: nav.decodedBodySize,
        }));
      });

      return ok({ metrics, navigationTiming: navEntries });
    } finally {
      await client.detach();
    }
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`get_web_perf_metrics failed: ${message}`, hint);
  }
}

export async function takeHeapSnapshot(
  args: z.infer<typeof takeHeapSnapshotSchema>,
): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    const client = await rec.page.context().newCDPSession(rec.page);

    try {
      const chunks: string[] = [];

      client.on('HeapProfiler.addHeapSnapshotChunk', (params: { chunk: string }) => {
        chunks.push(params.chunk);
      });

      await client.send('HeapProfiler.takeHeapSnapshot', {
        reportProgress: false,
        treatGlobalObjectsAsRoots: true,
      });

      const snapshot = chunks.join('');
      const sizeBytes = Buffer.byteLength(snapshot, 'utf8');

      const outputPath = args.outputPath ?? join(tmpdir(), `heap-${Date.now()}.heapsnapshot`);

      await writeFile(outputPath, snapshot, 'utf8');

      return ok({ path: outputPath, sizeBytes });
    } finally {
      await client.detach();
    }
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`take_heap_snapshot failed: ${message}`, hint);
  }
}
