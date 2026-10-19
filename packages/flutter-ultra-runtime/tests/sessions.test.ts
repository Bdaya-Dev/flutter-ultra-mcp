// hac#545 / flutter-ultra-mcp#545 — SessionRegistry.findActiveByTarget.
//
// `launch_app` must be able to answer "is there already a live session for
// this project+device" from the MCP's OWN registry (sessions.json), never
// from command-line text. These tests seed sessions.json directly (bypassing
// `attach()`, which would otherwise try a real VM-service connection) and
// assert the lookup's matching + normalization + tie-break rules.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  emptySessionsFile,
  SessionsFileSchema,
  type Session,
} from '@flutter-ultra/mcp-runtime';
import { sessionsFilePath, stateWriteAtomic } from '@flutter-ultra/state-store';
import { createSessionRegistry } from '../src/sessions.js';

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    uri: `ws://127.0.0.1:1234/${overrides.id}=/ws`,
    source: 'launched',
    clientName: `flutter-ultra/test/${overrides.id}`,
    attachedAt: 1,
    lastSeenAt: 1,
    status: 'ready',
    ...overrides,
  };
}

describe('SessionRegistry.findActiveByTarget', () => {
  let dir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fu-sessions-'));
    prevDataDir = process.env.FLUTTER_ULTRA_DATA_DIR;
    process.env.FLUTTER_ULTRA_DATA_DIR = dir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.FLUTTER_ULTRA_DATA_DIR;
    else process.env.FLUTTER_ULTRA_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  function registry() {
    return createSessionRegistry({ serverName: 'test', logger: createLogger({ server: 'test' }) });
  }

  async function seed(sessions: Session[]): Promise<void> {
    await stateWriteAtomic(
      sessionsFilePath(),
      { ...emptySessionsFile(), sessions },
      SessionsFileSchema,
    );
  }

  it('finds the live session for a matching project+device', async () => {
    await seed([
      makeSession({ id: 'session-a', pid: 111, projectRoot: 'C:\\proj', device: 'chrome' }),
    ]);
    const found = await registry().findActiveByTarget('C:\\proj', 'chrome');
    expect(found?.id).toBe('session-a');
    expect(found?.pid).toBe(111);
  });

  it('returns undefined when nothing matches', async () => {
    await seed([]);
    const found = await registry().findActiveByTarget('C:\\proj', 'chrome');
    expect(found).toBeUndefined();
  });

  it('ignores a terminated session for the same project+device', async () => {
    await seed([
      makeSession({
        id: 'session-a',
        pid: 111,
        projectRoot: 'C:\\proj',
        device: 'chrome',
        status: 'terminated',
        terminatedAt: 2,
      }),
    ]);
    const found = await registry().findActiveByTarget('C:\\proj', 'chrome');
    expect(found).toBeUndefined();
  });

  it('treats a stale (failed-attach) session as still live — its process may still be running', async () => {
    await seed([
      makeSession({
        id: 'session-a',
        pid: 111,
        projectRoot: 'C:\\proj',
        device: 'chrome',
        status: 'stale',
      }),
    ]);
    const found = await registry().findActiveByTarget('C:\\proj', 'chrome');
    expect(found?.id).toBe('session-a');
  });

  it('ignores a session for a different device on the same project', async () => {
    await seed([
      makeSession({ id: 'session-a', pid: 111, projectRoot: 'C:\\proj', device: 'windows' }),
    ]);
    const found = await registry().findActiveByTarget('C:\\proj', 'chrome');
    expect(found).toBeUndefined();
  });

  it('ignores a session for a different project on the same device', async () => {
    await seed([
      makeSession({ id: 'session-a', pid: 111, projectRoot: 'C:\\other-proj', device: 'chrome' }),
    ]);
    const found = await registry().findActiveByTarget('C:\\proj', 'chrome');
    expect(found).toBeUndefined();
  });

  it('normalizes path separators / "." segments before comparing projectRoot', async () => {
    await seed([
      makeSession({ id: 'session-a', pid: 111, projectRoot: 'C:/proj/.', device: 'chrome' }),
    ]);
    const found = await registry().findActiveByTarget('C:\\proj', 'chrome');
    expect(found?.id).toBe('session-a');
  });

  it('returns the most recently attached session when more than one matches', async () => {
    await seed([
      makeSession({
        id: 'session-old',
        pid: 111,
        projectRoot: 'C:\\proj',
        device: 'chrome',
        attachedAt: 1,
      }),
      makeSession({
        id: 'session-new',
        pid: 222,
        projectRoot: 'C:\\proj',
        device: 'chrome',
        attachedAt: 2,
      }),
    ]);
    const found = await registry().findActiveByTarget('C:\\proj', 'chrome');
    expect(found?.id).toBe('session-new');
  });
});
