// Tests for web performance tool schemas.
//
// CDP-dependent functionality (actual metric reads, heap snapshot) requires a
// live browser and is not unit-tested here. These tests verify:
//   - Tool names and descriptions are correct.
//   - Input schemas accept valid inputs and reject invalid ones.
//   - The tools appear in the browser server tool registry.

import { describe, it, expect } from 'vitest';
import { buildToolRegistry } from '../src/index.js';
import { getWebPerfMetricsSchema, takeHeapSnapshotSchema } from '../src/schemas.js';

describe('flutter-ultra-browser web perf tools', () => {
  const registry = buildToolRegistry();

  it('registers get_web_perf_metrics', () => {
    expect(registry.has('get_web_perf_metrics')).toBe(true);
  });

  it('registers take_heap_snapshot', () => {
    expect(registry.has('take_heap_snapshot')).toBe(true);
  });

  it('get_web_perf_metrics has non-empty description', () => {
    const tool = registry.get('get_web_perf_metrics');
    expect(tool?.description.length).toBeGreaterThan(0);
  });

  it('take_heap_snapshot has non-empty description', () => {
    const tool = registry.get('take_heap_snapshot');
    expect(tool?.description.length).toBeGreaterThan(0);
  });
});

describe('getWebPerfMetricsSchema', () => {
  it('accepts a valid pageId', () => {
    expect(getWebPerfMetricsSchema.safeParse({ pageId: 'page-abc-123' }).success).toBe(true);
  });

  it('rejects missing pageId', () => {
    expect(getWebPerfMetricsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(getWebPerfMetricsSchema.safeParse('bad').success).toBe(false);
    expect(getWebPerfMetricsSchema.safeParse(null).success).toBe(false);
  });

  it('rejects extra keys (strict schema)', () => {
    expect(getWebPerfMetricsSchema.safeParse({ pageId: 'abc', extra: true }).success).toBe(false);
  });
});

describe('takeHeapSnapshotSchema', () => {
  it('accepts a valid pageId without outputPath', () => {
    expect(takeHeapSnapshotSchema.safeParse({ pageId: 'page-abc-123' }).success).toBe(true);
  });

  it('accepts a valid pageId with outputPath', () => {
    expect(
      takeHeapSnapshotSchema.safeParse({
        pageId: 'page-abc-123',
        outputPath: '/tmp/heap.heapsnapshot',
      }).success,
    ).toBe(true);
  });

  it('rejects missing pageId', () => {
    expect(takeHeapSnapshotSchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(takeHeapSnapshotSchema.safeParse('bad').success).toBe(false);
    expect(takeHeapSnapshotSchema.safeParse(null).success).toBe(false);
  });

  it('rejects extra keys (strict schema)', () => {
    expect(takeHeapSnapshotSchema.safeParse({ pageId: 'abc', extra: true }).success).toBe(false);
  });
});
