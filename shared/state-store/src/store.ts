// Read-modify-write JSON state files with proper-lockfile.
//
// Pattern: stateUpdate(path, defaultValue, schema, mutator) takes a lock on
// the file, reads & parses the current state (creating with defaultValue if
// missing), runs the mutator, writes back atomically (via tmp + rename),
// then releases the lock.
//
// Concurrent processes (e.g. runtime + gesture both touching sessions.json)
// serialize via the lock; rare reads can use stateRead without a lock.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { z } from 'zod';

export interface StateUpdateOptions {
  // proper-lockfile retry config; defaults to 5 retries with exp backoff.
  retries?: number;
  // milliseconds; stale lock files older than this are ignored.
  staleMs?: number;
}

const DEFAULT_UPDATE_OPTIONS: Required<StateUpdateOptions> = {
  retries: 5,
  staleMs: 10_000,
};

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export async function stateRead<T>(
  path: string,
  defaultValue: T,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8');
    return schema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultValue;
    }
    throw err;
  }
}

export async function stateWriteAtomic<T>(
  path: string,
  value: T,
  schema?: z.ZodType<T>,
): Promise<void> {
  await ensureDir(path);
  // Validate before write so we never persist a malformed file.
  const validated = schema ? schema.parse(value) : value;
  const text = JSON.stringify(validated, null, 2);
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

// Take a lock, read, mutate, write back, release. Returns the post-mutation
// value. Mutator must return the new state; it may return the same reference
// after in-place edits.
export async function stateUpdate<T>(
  path: string,
  defaultValue: T,
  schema: z.ZodType<T>,
  mutator: (current: T) => T | Promise<T>,
  options: StateUpdateOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_UPDATE_OPTIONS, ...options };
  await ensureDir(path);
  // proper-lockfile requires the locked file to exist.
  try {
    await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await stateWriteAtomic(path, defaultValue, schema);
    } else throw err;
  }

  const release = await lockfile.lock(path, {
    retries: { retries: opts.retries, factor: 2, minTimeout: 50, maxTimeout: 1_000 },
    stale: opts.staleMs,
    realpath: false,
  });
  try {
    const current = await stateRead(path, defaultValue, schema);
    const next = await mutator(current);
    await stateWriteAtomic(path, next, schema);
    return next;
  } finally {
    await release();
  }
}

// Append-only JSONL writer for streams (log tails, screencast frames, etc.).
// Bounded by maxLines; oldest dropped when cap reached (re-writes the file).
export async function appendJsonl(
  path: string,
  entry: unknown,
  options: { maxLines?: number } = {},
): Promise<void> {
  const maxLines = options.maxLines ?? 10_000;
  await ensureDir(path);
  const line = JSON.stringify(entry) + '\n';

  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const lines = existing.length > 0 ? existing.trimEnd().split('\n') : [];
  lines.push(line.trimEnd());
  let content: string;
  if (lines.length > maxLines) {
    content = lines.slice(lines.length - maxLines).join('\n') + '\n';
  } else {
    content = lines.join('\n') + '\n';
  }
  await writeFile(path, content, 'utf8');
}

export interface JsonlReadResult<T> {
  entries: T[];
  // 1-based line index after the LAST returned entry. Pass back as `afterCursor`
  // to continue from there.
  cursor: number;
  // Total lines in the file at read time (useful for "any new since cursor?").
  totalLines: number;
}

export async function readJsonl<T>(
  path: string,
  parse: (raw: unknown) => T,
  afterCursor = 0,
  maxEntries = 500,
): Promise<JsonlReadResult<T>> {
  let raw = '';
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: [], cursor: 0, totalLines: 0 };
    }
    throw err;
  }
  const lines = raw.length > 0 ? raw.trimEnd().split('\n') : [];
  const totalLines = lines.length;
  const startIdx = Math.max(0, afterCursor);
  const sliceEnd = Math.min(totalLines, startIdx + maxEntries);
  const slice = lines.slice(startIdx, sliceEnd);
  const entries: T[] = [];
  for (const line of slice) {
    if (!line) continue;
    try {
      entries.push(parse(JSON.parse(line)));
    } catch {
      // Malformed line — skip but keep going.
    }
  }
  return { entries, cursor: sliceEnd, totalLines };
}

// Re-export the path resolver so consumers don't import from two paths.
export {
  pluginDataDir,
  stateDir,
  sessionsFilePath,
  jobsDir,
  jobFilePath,
  streamsDir,
  streamFilePath,
  locksDir,
} from './paths.js';

// Helper for callers that need to join paths under the state root.
export function stateRelative(...segments: string[]): string {
  // Re-export of join for convenience.
  return join(...segments);
}
