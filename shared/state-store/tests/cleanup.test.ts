import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupStaleState } from '../src/cleanup.js';

const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

describe('cleanupStaleState', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'fu-cleanup-'));
  });
  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  // --- Sessions ---

  it('removes stale terminated sessions beyond maxAge', async () => {
    const now = Date.now();
    const sessionsFile = join(stateDir, 'sessions.json');
    await writeFile(
      sessionsFile,
      JSON.stringify({
        schemaVersion: 1,
        sessions: [
          {
            id: 'old-terminated',
            status: 'terminated',
            lastSeenAt: now - 2 * ONE_DAY_MS,
            terminatedAt: now - 2 * ONE_DAY_MS,
          },
        ],
      }),
      'utf8',
    );

    const report = await cleanupStaleState({ stateDir, sessionMaxAgeMs: ONE_DAY_MS });
    expect(report.sessionsRemoved).toBe(1);

    const remaining = JSON.parse(
      await (await import('node:fs/promises')).readFile(sessionsFile, 'utf8'),
    );
    expect(remaining.sessions).toHaveLength(0);
  });

  it('keeps fresh terminated sessions within maxAge', async () => {
    const now = Date.now();
    const sessionsFile = join(stateDir, 'sessions.json');
    await writeFile(
      sessionsFile,
      JSON.stringify({
        schemaVersion: 1,
        sessions: [
          {
            id: 'fresh-terminated',
            status: 'terminated',
            lastSeenAt: now - 10_000,
            terminatedAt: now - 10_000,
          },
        ],
      }),
      'utf8',
    );

    const report = await cleanupStaleState({ stateDir, sessionMaxAgeMs: ONE_DAY_MS });
    expect(report.sessionsRemoved).toBe(0);
  });

  it('keeps active (non-terminal) sessions regardless of age', async () => {
    const now = Date.now();
    const sessionsFile = join(stateDir, 'sessions.json');
    await writeFile(
      sessionsFile,
      JSON.stringify({
        schemaVersion: 1,
        sessions: [
          {
            id: 'old-ready',
            status: 'ready',
            lastSeenAt: now - 10 * ONE_DAY_MS,
          },
        ],
      }),
      'utf8',
    );

    const report = await cleanupStaleState({ stateDir, sessionMaxAgeMs: ONE_DAY_MS });
    expect(report.sessionsRemoved).toBe(0);
  });

  it('handles missing sessions.json gracefully (no error)', async () => {
    const report = await cleanupStaleState({ stateDir });
    expect(report.sessionsRemoved).toBe(0);
    expect(report.jobFilesRemoved).toBe(0);
  });

  // --- Job files ---

  it('removes terminal job files older than jobMaxAgeMs', async () => {
    const jobsDir = join(stateDir, 'jobs');
    await mkdir(jobsDir, { recursive: true });
    const now = Date.now();
    const oldJobId = 'job_old';
    const jobFile = join(jobsDir, `${oldJobId}.json`);
    const stdoutLog = join(jobsDir, `${oldJobId}.stdout.log`);
    await writeFile(
      jobFile,
      JSON.stringify({ jobId: oldJobId, status: 'completed', finishedAt: now - 2 * ONE_HOUR_MS }),
      'utf8',
    );
    await writeFile(stdoutLog, 'some output', 'utf8');

    const report = await cleanupStaleState({ stateDir, jobMaxAgeMs: ONE_HOUR_MS });
    expect(report.jobFilesRemoved).toBe(1);
    expect(existsSync(jobFile)).toBe(false);
    expect(existsSync(stdoutLog)).toBe(false);
  });

  it('keeps terminal job files within jobMaxAgeMs', async () => {
    const jobsDir = join(stateDir, 'jobs');
    await mkdir(jobsDir, { recursive: true });
    const now = Date.now();
    const jobId = 'job_fresh';
    const jobFile = join(jobsDir, `${jobId}.json`);
    await writeFile(
      jobFile,
      JSON.stringify({ jobId, status: 'completed', finishedAt: now - 10_000 }),
      'utf8',
    );

    const report = await cleanupStaleState({ stateDir, jobMaxAgeMs: ONE_HOUR_MS });
    expect(report.jobFilesRemoved).toBe(0);
    expect(existsSync(jobFile)).toBe(true);
  });

  it('keeps running jobs even if old', async () => {
    const jobsDir = join(stateDir, 'jobs');
    await mkdir(jobsDir, { recursive: true });
    const now = Date.now();
    const jobId = 'job_running';
    const jobFile = join(jobsDir, `${jobId}.json`);
    await writeFile(
      jobFile,
      JSON.stringify({ jobId, status: 'running', startedAt: now - 5 * ONE_HOUR_MS }),
      'utf8',
    );

    const report = await cleanupStaleState({ stateDir, jobMaxAgeMs: ONE_HOUR_MS });
    expect(report.jobFilesRemoved).toBe(0);
    expect(existsSync(jobFile)).toBe(true);
  });

  it('handles missing jobs/ directory gracefully', async () => {
    const sessionsFile = join(stateDir, 'sessions.json');
    await writeFile(sessionsFile, JSON.stringify({ schemaVersion: 1, sessions: [] }), 'utf8');
    const report = await cleanupStaleState({ stateDir });
    expect(report.jobFilesRemoved).toBe(0);
  });
});
