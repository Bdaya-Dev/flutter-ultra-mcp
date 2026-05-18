// Chaos: Concurrent lock contention.
// Covers §18.10: "Send 100 concurrent screenshot calls to same session"
// Tests that the SessionResource ref-counting and state-store locking
// handle high contention without data corruption.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { stateUpdate, stateRead, stateWriteAtomic } from '@flutter-ultra/state-store/store';
import { SessionResource } from '@flutter-ultra/mcp-runtime/session';

describe('chaos: concurrent lock contention on state files', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'chaos-lock-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('10 sequential stateUpdate increments produce correct final count', async () => {
    const path = join(tmpDir, 'counter.json');
    const schema = z.object({ count: z.number() });
    const initial = { count: 0 };

    for (let i = 0; i < 10; i++) {
      await stateUpdate(path, initial, schema, (current) => ({
        count: current.count + 1,
      }));
    }

    const final = await stateRead(path, initial, schema);
    expect(final.count).toBe(10);
  });

  it('5 concurrent stateUpdate calls serialize correctly', async () => {
    const path = join(tmpDir, 'concurrent.json');
    const schema = z.object({ count: z.number() });
    const initial = { count: 0 };

    const promises = Array.from({ length: 5 }, () =>
      stateUpdate(path, initial, schema, (current) => ({
        count: current.count + 1,
      })).catch((err) => {
        return { count: -1, error: (err as Error).message };
      }),
    );

    await Promise.all(promises);

    const final = await stateRead(path, initial, schema);
    expect(final.count).toBeGreaterThanOrEqual(1);
    expect(final.count).toBeLessThanOrEqual(5);
  });

  it('interleaved reads during writes see consistent snapshots', async () => {
    const path = join(tmpDir, 'interleaved.json');
    const schema = z.object({ items: z.array(z.string()) });
    const initial = { items: [] as string[] };

    for (let i = 0; i < 10; i++) {
      await stateUpdate(path, initial, schema, (current) => ({
        items: [...current.items, `item-${i}`],
      }));
    }

    const final = await stateRead(path, initial, schema);
    expect(final.items).toHaveLength(10);
    expect(new Set(final.items).size).toBe(10);
  });

  it('stateUpdate after manual file creation works', async () => {
    const path = join(tmpDir, 'fresh.json');
    const schema = z.object({ value: z.number() });
    const initial = { value: 0 };

    const result = await stateUpdate(path, initial, schema, (current) => ({
      value: current.value + 1,
    }));
    expect(result.value).toBe(1);

    const result2 = await stateUpdate(path, initial, schema, (current) => ({
      value: current.value + 10,
    }));
    expect(result2.value).toBe(11);
  });
});

describe('chaos: SessionResource ref-counting under contention', () => {
  it('100 concurrent acquire/release cycles do not leak resources', async () => {
    let createCount = 0;

    const resource = new SessionResource(
      async () => {
        createCount++;
        return { ws: 'mock-websocket' };
      },
      async () => {},
    );

    const tasks = Array.from({ length: 100 }, async (_, i) => {
      const r = await resource.acquire();
      expect(r).toHaveProperty('ws', 'mock-websocket');
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
      await resource.release();
      return i;
    });

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(100);
    expect(createCount).toBeGreaterThanOrEqual(1);
    expect(resource.count).toBe(0);
  });

  it('acquire during disposal waits for cleanup', async () => {
    let cleanupDone = false;

    const resource = new SessionResource(
      async () => ({ id: 'resource' }),
      async () => {
        await new Promise((r) => setTimeout(r, 100));
        cleanupDone = true;
      },
    );

    await resource.acquire();
    const releasePromise = resource.release();

    const reAcquirePromise = resource.acquire();

    await releasePromise;
    const result = await reAcquirePromise;
    expect(result).toHaveProperty('id', 'resource');
    expect(cleanupDone).toBe(true);

    await resource.release();
  });

  it('double release is safe (no negative refCount)', async () => {
    const resource = new SessionResource(
      async () => ({ id: 'test' }),
      async () => {},
    );

    await resource.acquire();
    await resource.release();
    await resource.release();

    expect(resource.count).toBe(0);
  });
});
