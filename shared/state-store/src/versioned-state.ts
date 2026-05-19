// Schema versioning for state files.
//
// State files written by older plugin versions may be missing schemaVersion or
// have an older version number. readVersionedState runs migrations in sequence
// to bring the data up to the current version before returning it.
//
// If the on-disk version is NEWER than currentVersion (a downgrade scenario),
// the file is reset to defaultData to avoid parse errors from unknown fields.

import { readFile } from 'node:fs/promises';

export interface VersionedState<T> {
  schemaVersion: number;
  data: T;
}

export interface Migration<T> {
  fromVersion: number;
  toVersion: number;
  migrate: (data: unknown) => T;
}

/**
 * Read a versioned state file and run any necessary migrations.
 *
 * - Missing file → returns { schemaVersion: currentVersion, data: defaultData }
 * - Missing schemaVersion field → treated as version 0 (legacy)
 * - Version older than currentVersion → migrations run in order
 * - Version newer than currentVersion → reset to defaultData (downgrade safety)
 * - Parse error → reset to defaultData
 */
export async function readVersionedState<T>(
  path: string,
  currentVersion: number,
  migrations: Migration<T>[],
  defaultData: T,
): Promise<VersionedState<T>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: currentVersion, data: defaultData };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt JSON — reset to safe default.
    return { schemaVersion: currentVersion, data: defaultData };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { schemaVersion: currentVersion, data: defaultData };
  }

  const record = parsed as Record<string, unknown>;
  const onDiskVersion =
    typeof record['schemaVersion'] === 'number' ? record['schemaVersion'] : 0;

  // Downgrade: file is from a future version we don't know about.
  if (onDiskVersion > currentVersion) {
    return { schemaVersion: currentVersion, data: defaultData };
  }

  // Already current — return the data section directly.
  if (onDiskVersion === currentVersion) {
    const data = 'data' in record ? (record['data'] as T) : (parsed as unknown as T);
    return { schemaVersion: currentVersion, data };
  }

  // Run migrations in order, starting from the on-disk version.
  const sortedMigrations = [...migrations].sort((a, b) => a.fromVersion - b.fromVersion);
  let version = onDiskVersion;
  // For version-0 legacy files the whole parsed object IS the data (no wrapper).
  let data: unknown = 'data' in record ? record['data'] : parsed;

  for (const m of sortedMigrations) {
    if (m.fromVersion !== version) continue;
    data = m.migrate(data);
    version = m.toVersion;
    if (version === currentVersion) break;
  }

  // If migrations didn't reach currentVersion, use defaultData as fallback.
  if (version !== currentVersion) {
    return { schemaVersion: currentVersion, data: defaultData };
  }

  return { schemaVersion: currentVersion, data: data as T };
}
