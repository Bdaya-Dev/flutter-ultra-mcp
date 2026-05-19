import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readVersionedState } from '../src/versioned-state.js';

interface DataV0 {
  items: string[];
}

interface DataV1 {
  items: string[];
  count: number;
}

interface DataV2 {
  items: string[];
  count: number;
  version: string;
}

const migrations = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: (data: unknown): DataV1 => {
      const d = data as DataV0;
      return { items: d.items ?? [], count: (d.items ?? []).length };
    },
  },
  {
    fromVersion: 1,
    toVersion: 2,
    migrate: (data: unknown): DataV2 => {
      const d = data as DataV1;
      return { ...d, version: 'v2' };
    },
  },
];

const defaultData: DataV2 = { items: [], count: 0, version: 'v2' };

describe('readVersionedState', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fu-versioned-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaultData for missing file', async () => {
    const result = await readVersionedState(
      join(dir, 'missing.json'),
      2,
      migrations,
      defaultData,
    );
    expect(result).toEqual({ schemaVersion: 2, data: defaultData });
  });

  it('returns defaultData for corrupt JSON', async () => {
    const file = join(dir, 'corrupt.json');
    await writeFile(file, 'not json at all', 'utf8');
    const result = await readVersionedState(file, 2, migrations, defaultData);
    expect(result).toEqual({ schemaVersion: 2, data: defaultData });
  });

  it('reads legacy file with no schemaVersion field (treated as v0) and migrates to current', async () => {
    // Legacy format: no wrapper, whole object IS the data, no schemaVersion.
    const file = join(dir, 'legacy.json');
    const legacyData: DataV0 = { items: ['a', 'b'] };
    await writeFile(file, JSON.stringify(legacyData), 'utf8');
    const result = await readVersionedState(file, 2, migrations, defaultData);
    expect(result.schemaVersion).toBe(2);
    expect(result.data).toEqual({ items: ['a', 'b'], count: 2, version: 'v2' });
  });

  it('migrates v1 → v2 (partial migration from intermediate version)', async () => {
    const file = join(dir, 'v1.json');
    const v1File = { schemaVersion: 1, data: { items: ['x'], count: 1 } };
    await writeFile(file, JSON.stringify(v1File), 'utf8');
    const result = await readVersionedState(file, 2, migrations, defaultData);
    expect(result.schemaVersion).toBe(2);
    expect(result.data).toEqual({ items: ['x'], count: 1, version: 'v2' });
  });

  it('skips migration for a file already at currentVersion', async () => {
    const file = join(dir, 'current.json');
    const currentFile = {
      schemaVersion: 2,
      data: { items: ['z'], count: 1, version: 'v2' },
    };
    await writeFile(file, JSON.stringify(currentFile), 'utf8');
    const result = await readVersionedState(file, 2, migrations, defaultData);
    expect(result.schemaVersion).toBe(2);
    expect(result.data).toEqual({ items: ['z'], count: 1, version: 'v2' });
  });

  it('resets to defaultData when file schemaVersion > currentVersion (downgrade)', async () => {
    const file = join(dir, 'future.json');
    const futureFile = {
      schemaVersion: 99,
      data: { items: ['future'], count: 1, version: 'v99', unknownField: true },
    };
    await writeFile(file, JSON.stringify(futureFile), 'utf8');
    const result = await readVersionedState(file, 2, migrations, defaultData);
    expect(result).toEqual({ schemaVersion: 2, data: defaultData });
  });
});
