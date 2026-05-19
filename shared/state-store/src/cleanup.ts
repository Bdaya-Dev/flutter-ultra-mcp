// Startup cleanup for stale state files.
//
// Removes expired session records from sessions.json and terminal job files
// from the jobs/ directory. Called once at server startup — intentionally
// synchronous-friendly but implemented async for consistency with the rest of
// the state-store API.

import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { stateUpdate } from './store.js';

export interface CleanupOptions {
  stateDir: string;
  /** Max age for sessions with status=terminated (ms). Default: 24 h. */
  sessionMaxAgeMs?: number;
  /** Max age for terminal job files (ms). Default: 1 h. */
  jobMaxAgeMs?: number;
}

export interface CleanupReport {
  sessionsRemoved: number;
  jobFilesRemoved: number;
}

const DEFAULT_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1_000; // 24 h
const DEFAULT_JOB_MAX_AGE_MS = 60 * 60 * 1_000; // 1 h

// Minimal Zod-free schema we need to read/write sessions.json for cleanup.
// We avoid importing the full mcp-runtime schema to keep state-store
// dependency-free from the consuming packages.
import { z } from 'zod';

const CleanupSessionSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    lastSeenAt: z.number().int(),
    terminatedAt: z.number().int().optional(),
  })
  .passthrough();

const CleanupSessionsFileSchema = z
  .object({
    schemaVersion: z.number().int().optional(),
    sessions: z.array(CleanupSessionSchema),
  })
  .passthrough();

type CleanupSessionsFile = z.infer<typeof CleanupSessionsFileSchema>;

const TERMINAL_STATUSES = new Set(['terminated', 'stale', 'completed', 'failed', 'cancelled']);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export async function cleanupStaleState(opts: CleanupOptions): Promise<CleanupReport> {
  const { stateDir } = opts;
  const sessionMaxAgeMs = opts.sessionMaxAgeMs ?? DEFAULT_SESSION_MAX_AGE_MS;
  const jobMaxAgeMs = opts.jobMaxAgeMs ?? DEFAULT_JOB_MAX_AGE_MS;
  const now = Date.now();

  const sessionsFile = join(stateDir, 'sessions.json');
  const jobsDirectory = join(stateDir, 'jobs');

  let sessionsRemoved = 0;

  // --- Session cleanup ---
  try {
    const defaultFile: CleanupSessionsFile = { sessions: [] };
    await stateUpdate(sessionsFile, defaultFile, CleanupSessionsFileSchema, (current) => {
      const before = current.sessions.length;
      const kept = current.sessions.filter((s) => {
        if (!TERMINAL_STATUSES.has(s.status)) return true; // keep active sessions
        // Use terminatedAt if available, otherwise fall back to lastSeenAt.
        const age = now - (s.terminatedAt ?? s.lastSeenAt);
        return age < sessionMaxAgeMs;
      });
      sessionsRemoved = before - kept.length;
      return { ...current, sessions: kept };
    });
  } catch {
    // sessions.json missing or unreadable — nothing to clean.
  }

  // --- Job file cleanup ---
  let jobFilesRemoved = 0;
  try {
    const entries = await readdir(jobsDirectory);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const jobPath = join(jobsDirectory, entry);
      try {
        const content = await readFile(jobPath, 'utf8');
        const record = JSON.parse(content) as Record<string, unknown>;
        const status = typeof record['status'] === 'string' ? record['status'] : '';
        if (!TERMINAL_JOB_STATUSES.has(status)) continue; // still running
        const finishedAt =
          typeof record['finishedAt'] === 'number' ? record['finishedAt'] : undefined;
        if (finishedAt === undefined) continue; // no finish timestamp — leave alone
        if (now - finishedAt < jobMaxAgeMs) continue; // not old enough yet
        await rm(jobPath, { force: true });
        // Also remove sibling stdout log if present.
        const stdoutLog = jobPath.replace(/\.json$/, '.stdout.log');
        await rm(stdoutLog, { force: true });
        const stdoutLogOld = stdoutLog + '.old';
        await rm(stdoutLogOld, { force: true });
        jobFilesRemoved += 1;
      } catch {
        // Corrupt or locked file — skip silently.
      }
    }
  } catch {
    // jobs/ directory missing — nothing to clean.
  }

  return { sessionsRemoved, jobFilesRemoved };
}
