import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { appendJsonl, readJsonl, stateRead, stateUpdate, stateWriteAtomic } from '../src/index.js';

const RecordSchema = z.object({ count: z.number().int(), items: z.array(z.string()) });
type Record = z.infer<typeof RecordSchema>;

describe('stateRead / stateWriteAtomic', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fu-state-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns default when missing', async () => {
    const file = join(dir, 'missing.json');
    const value = await stateRead(file, { count: 0, items: [] } satisfies Record, RecordSchema);
    expect(value).toEqual({ count: 0, items: [] });
  });

  it('round-trips written state', async () => {
    const file = join(dir, 'round.json');
    await stateWriteAtomic(file, { count: 2, items: ['a', 'b'] } satisfies Record, RecordSchema);
    const read = await stateRead(file, { count: 0, items: [] } satisfies Record, RecordSchema);
    expect(read).toEqual({ count: 2, items: ['a', 'b'] });
  });

  it('throws on validation failure when reading garbage', async () => {
    const file = join(dir, 'garbage.json');
    await stateWriteAtomic(file, { count: 1, items: [] } satisfies Record, RecordSchema);
    // overwrite with invalid JSON shape
    await (
      await import('node:fs/promises')
    ).writeFile(file, JSON.stringify({ wrong: true }), 'utf8');
    await expect(
      stateRead(file, { count: 0, items: [] } satisfies Record, RecordSchema),
    ).rejects.toThrow();
  });
});

describe('stateUpdate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fu-state-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('mutates atomically', async () => {
    const file = join(dir, 'mut.json');
    const next = await stateUpdate(
      file,
      { count: 0, items: [] } satisfies Record,
      RecordSchema,
      (current) => ({ count: current.count + 1, items: [...current.items, 'new'] }),
    );
    expect(next).toEqual({ count: 1, items: ['new'] });
    const reread = await stateRead(file, { count: 0, items: [] } satisfies Record, RecordSchema);
    expect(reread).toEqual({ count: 1, items: ['new'] });
  });
});

describe('appendJsonl + readJsonl', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fu-state-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends and reads back with cursor', async () => {
    const file = join(dir, 'log.jsonl');
    await appendJsonl(file, { msg: 'one' });
    await appendJsonl(file, { msg: 'two' });
    await appendJsonl(file, { msg: 'three' });
    const r1 = await readJsonl(file, (raw) => raw, 0, 2);
    expect(r1.entries).toEqual([{ msg: 'one' }, { msg: 'two' }]);
    expect(r1.cursor).toBe(2);
    const r2 = await readJsonl(file, (raw) => raw, r1.cursor);
    expect(r2.entries).toEqual([{ msg: 'three' }]);
    expect(r2.cursor).toBe(3);
  });

  it('caps to maxLines (FIFO drop)', async () => {
    const file = join(dir, 'capped.jsonl');
    for (let i = 0; i < 10; i++) {
      await appendJsonl(file, { i }, { maxLines: 5 });
    }
    const r = await readJsonl(file, (raw) => raw, 0, 100);
    expect(r.entries).toEqual([{ i: 5 }, { i: 6 }, { i: 7 }, { i: 8 }, { i: 9 }]);
  });
});
