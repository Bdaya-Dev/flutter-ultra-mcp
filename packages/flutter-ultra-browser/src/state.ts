// Minimal file-based state shim per plan §4. Replaces eventual
// @flutter-ultra/state-store. atomic read-modify-write via proper-lockfile.

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import lockfile from 'proper-lockfile';
import { log } from './logger.js';

function defaultStateDir(): string {
  return process.env.FLUTTER_ULTRA_STATE_DIR ?? join(homedir(), '.flutter-ultra', 'state');
}

export function stateDir(): string {
  return defaultStateDir();
}

export function statePath(relative: string): string {
  return join(stateDir(), relative);
}

async function ensureFile(path: string, initial = '{}'): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    await writeFile(path, initial, 'utf8');
  }
}

export async function stateRead<T>(relative: string, fallback: T): Promise<T> {
  const path = statePath(relative);
  if (!existsSync(path)) return fallback;
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn('state_read_failed', { path, err: (err as Error).message });
    return fallback;
  }
}

export async function stateWrite<T>(
  relative: string,
  mutate: (current: T) => T,
  defaultValue: T,
): Promise<T> {
  const path = statePath(relative);
  await ensureFile(path, JSON.stringify(defaultValue));
  const release = await lockfile.lock(path, {
    retries: { retries: 10, minTimeout: 25, maxTimeout: 200 },
    realpath: false,
    stale: 30_000,
  });
  try {
    const raw = await readFile(path, 'utf8').catch(() => JSON.stringify(defaultValue));
    let current: T;
    try {
      current = JSON.parse(raw) as T;
    } catch {
      current = defaultValue;
    }
    const next = mutate(current);
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
    // atomic rename
    const { rename } = await import('node:fs/promises');
    await rename(tmp, path);
    return next;
  } finally {
    await release();
  }
}

export async function stateAppendJsonl(relative: string, line: unknown): Promise<void> {
  const path = statePath(relative);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(line) + '\n', 'utf8');
}

export async function stateReadJsonl<T>(relative: string): Promise<T[]> {
  const path = statePath(relative);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, 'utf8');
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      // skip malformed (e.g., partial line during a race)
    }
  }
  return out;
}
