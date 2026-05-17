// Verifies the read-only state-store consumer correctly parses sessions.json
// and per-session files written by flutter-ultra-runtime.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, readSessionsFile } from '../src/state-store.js';

function withTempDir(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fugesture-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe('state-store', () => {
  it(
    'returns [] when sessions.json is missing',
    withTempDir(async (dir) => {
      const sessions = await readSessionsFile(dir);
      expect(sessions).toEqual([]);
    }),
  );

  it(
    'parses sessions.json + per-session file',
    withTempDir(async (dir) => {
      const id = '11111111-1111-1111-1111-111111111111';
      writeFileSync(
        join(dir, 'sessions.json'),
        JSON.stringify({
          sessions: [
            {
              id,
              uri: 'ws://127.0.0.1:12345/ws',
              source: 'discovered',
              clientName: 'flutter-ultra/runtime/1234',
              attachedAt: 1_700_000_000,
              status: 'ready',
            },
          ],
        }),
      );
      writeFileSync(
        join(dir, `session-${id}.json`),
        JSON.stringify({
          id,
          uri: 'ws://127.0.0.1:99999/wsv2', // newer URI from per-session file
        }),
      );
      const session = await readSession(dir, id);
      expect(session?.uri).toBe('ws://127.0.0.1:99999/wsv2');
    }),
  );

  it(
    'returns null for unknown id',
    withTempDir(async (dir) => {
      writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ sessions: [] }));
      expect(await readSession(dir, '00000000-0000-0000-0000-000000000000')).toBeNull();
    }),
  );
});
