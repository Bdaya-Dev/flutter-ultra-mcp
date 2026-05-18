// Chaos: State file corruption and disk fault scenarios.
// Covers §18.10: "Corrupt state/sessions.json on disk",
// "TS server crashes mid-job -> fresh server start".

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  stateRead,
  stateUpdate,
  stateWriteAtomic,
  appendJsonl,
  readJsonl,
} from '@flutter-ultra/state-store/store';
import { corruptJsonFile, writeTruncatedJson } from './helpers/fault-injector.js';

const TestSchema = z.object({
  version: z.number(),
  data: z.string(),
});
type TestState = z.infer<typeof TestSchema>;

describe('chaos: state file corruption recovery', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'chaos-state-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('stateRead throws on corrupt JSON (not silently returns default)', async () => {
    const path = join(tmpDir, 'corrupt.json');
    await corruptJsonFile(path);

    const defaultVal: TestState = { version: 0, data: 'default' };
    await expect(stateRead(path, defaultVal, TestSchema)).rejects.toThrow();
  });

  it('stateUpdate fails on corrupt file, recovers after manual fix', async () => {
    const path = join(tmpDir, 'sessions.json');
    const defaultVal: TestState = { version: 1, data: 'initial' };

    await stateWriteAtomic(path, defaultVal, TestSchema);

    const read1 = await stateRead(path, defaultVal, TestSchema);
    expect(read1).toEqual(defaultVal);

    await corruptJsonFile(path);

    await expect(
      stateUpdate(path, defaultVal, TestSchema, (current) => ({
        ...current,
        version: current.version + 1,
      })),
    ).rejects.toThrow();

    await stateWriteAtomic(path, defaultVal, TestSchema);

    const recovered = await stateUpdate(path, defaultVal, TestSchema, (current) => ({
      ...current,
      version: 99,
      data: 'recovered',
    }));
    expect(recovered).toEqual({ version: 99, data: 'recovered' });
  });

  it('stateWriteAtomic does not leave .tmp files', async () => {
    const path = join(tmpDir, 'atomic-test.json');
    const value: TestState = { version: 1, data: 'x'.repeat(10000) };

    await stateWriteAtomic(path, value, TestSchema);

    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(value);

    const files = await readdir(tmpDir);
    expect(files.filter((f) => f.includes('.tmp'))).toHaveLength(0);
  });

  it('truncated JSON file is detected on read', async () => {
    const path = join(tmpDir, 'truncated.json');
    await writeTruncatedJson(path, { version: 1, data: 'complete' });

    const defaultVal: TestState = { version: 0, data: 'default' };
    await expect(stateRead(path, defaultVal, TestSchema)).rejects.toThrow();
  });

  it('sequential stateUpdate calls produce correct final state', async () => {
    const path = join(tmpDir, 'sequential.json');
    const defaultVal = { version: 0, data: 'start' };

    for (let i = 0; i < 10; i++) {
      await stateUpdate(path, defaultVal, TestSchema, (current) => ({
        ...current,
        version: current.version + 1,
      }));
    }

    const final = await stateRead(path, defaultVal, TestSchema);
    expect(final.version).toBe(10);
  });
});

describe('chaos: JSONL append under adverse conditions', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'chaos-jsonl-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('readJsonl skips malformed lines without crashing', async () => {
    const path = join(tmpDir, 'mixed.jsonl');
    const lines =
      [
        JSON.stringify({ ts: 1, msg: 'ok' }),
        '<<<CORRUPT LINE>>>',
        JSON.stringify({ ts: 2, msg: 'also ok' }),
        '{truncated',
        JSON.stringify({ ts: 3, msg: 'third' }),
      ].join('\n') + '\n';
    await mkdir(tmpDir, { recursive: true });
    await writeFile(path, lines, 'utf8');

    const result = await readJsonl(path, (raw) => raw as { ts: number; msg: string });
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual({ ts: 1, msg: 'ok' });
    expect(result.entries[2]).toEqual({ ts: 3, msg: 'third' });
  });

  it('appendJsonl respects maxLines cap under rapid writes', async () => {
    const path = join(tmpDir, 'capped.jsonl');

    for (let i = 0; i < 50; i++) {
      await appendJsonl(path, { seq: i }, { maxLines: 10 });
    }

    const result = await readJsonl(path, (raw) => raw as { seq: number });
    expect(result.totalLines).toBeLessThanOrEqual(10);
    expect(result.entries[result.entries.length - 1]).toEqual({ seq: 49 });
  });

  it('appendJsonl on non-existent directory creates it', async () => {
    const path = join(tmpDir, 'deep', 'nested', 'dir', 'stream.jsonl');
    await appendJsonl(path, { event: 'first' });
    const result = await readJsonl(path, (raw) => raw as { event: string });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual({ event: 'first' });
  });

  it('readJsonl on non-existent file returns empty without throwing', async () => {
    const path = join(tmpDir, 'nonexistent.jsonl');
    const result = await readJsonl(path, (raw) => raw);
    expect(result.entries).toHaveLength(0);
    expect(result.cursor).toBe(0);
  });
});

describe('chaos: job state survives server crash', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'chaos-jobs-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('job file persists across simulated process restart', async () => {
    const jobId = 'job-crash-test-001';
    const jobPath = join(tmpDir, 'jobs', `${jobId}.json`);

    const JobSchema = z.object({
      id: z.string(),
      status: z.enum(['running', 'completed', 'failed', 'cancelled']),
      startedAt: z.number(),
      command: z.string(),
      progress: z.object({ filesProcessed: z.number(), totalFiles: z.number() }),
    });

    const jobState = {
      id: jobId,
      status: 'running' as const,
      startedAt: Date.now(),
      command: 'build_runner_build',
      progress: { filesProcessed: 42, totalFiles: 100 },
    };

    await stateWriteAtomic(jobPath, jobState, JobSchema);

    const recovered = await stateRead(
      jobPath,
      { ...jobState, status: 'failed' as const },
      JobSchema,
    );
    expect(recovered.id).toBe(jobId);
    expect(recovered.status).toBe('running');
    expect(recovered.progress.filesProcessed).toBe(42);
  });
});
