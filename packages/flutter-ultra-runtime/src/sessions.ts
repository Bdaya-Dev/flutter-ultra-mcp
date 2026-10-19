// Session lifecycle — owned by the runtime server.
//
// Sessions are persisted to ${STATE_DIR}/sessions.json so other servers
// (gesture, devtools, patrol) can read the URI without IPC. We also keep
// in-memory VmServiceClient connections wrapped in SessionResource so
// parallel tool calls share one WebSocket per AC-R3 / §17.10.

import { randomUUID } from 'node:crypto';
import { win32 as pathWin32 } from 'node:path';
import {
  emptySessionsFile,
  makeClientName,
  SessionNotFoundError,
  SessionResource,
  SessionsFileSchema,
  SessionTerminatedError,
  type Logger,
  type Session,
  type SessionId,
  type SessionsFile,
  type SessionSource,
} from '@flutter-ultra/mcp-runtime';
import { sessionsFilePath, stateRead, stateUpdate } from '@flutter-ultra/state-store';
import { VmServiceClient } from '@flutter-ultra/vm-service-client';

export interface AttachOptions {
  uri: string;
  source: SessionSource;
  pid?: number;
  projectRoot?: string;
  device?: string;
  appName?: string;
  rawVmUri?: string;
}

export interface AcquiredClient {
  client: VmServiceClient;
  release(): Promise<void>;
}

export interface SessionRegistry {
  attach(opts: AttachOptions): Promise<Session>;
  detach(id: SessionId, reason?: string): Promise<void>;
  get(id: SessionId): Promise<Session>;
  list(): Promise<Session[]>;
  /**
   * hac#545: the live (non-terminated) session, if any, that was launched
   * for this exact project + device pair. Resolves both sides with
   * `path.resolve` so a caller doesn't have to pre-normalize. Structured
   * lookup against our own registry — never command-line text matching.
   * When more than one session matches (should not happen once callers use
   * this before every launch), the most recently attached one wins.
   */
  findActiveByTarget(projectRoot: string, device: string): Promise<Session | undefined>;
  markStatus(id: SessionId, status: Session['status'], reason?: string): Promise<Session>;
  acquireClient(id: SessionId): Promise<AcquiredClient>;
  shutdown(): Promise<void>;
}

interface ResourceEntry {
  resource: SessionResource<VmServiceClient>;
  clientName: string;
}

/**
 * Normalizes a project-root path for comparison, by design independent of
 * `process.platform` (host-platform-correct, not just "correct on Windows").
 *
 * `path.resolve` (the platform-default) delegates to `path.win32` on
 * Windows and `path.posix` elsewhere. POSIX's resolver only treats `/` as a
 * separator, so a Windows-style root (`C:\proj`, the common shape for this
 * tool) and an equivalent path spelled with forward slashes (`C:/proj/.`)
 * resolve to two different strings when this process happens to run on
 * Linux/macOS (e.g. this package's own CI matrix, or a non-Windows host).
 * `path.win32`'s resolver understands BOTH separators and still normalizes
 * a plain POSIX absolute path correctly, so using it unconditionally keeps
 * the comparison correct on every host without needing a `process.platform`
 * branch.
 */
function normalizeProjectRoot(p: string): string {
  return pathWin32.resolve(p);
}

export function createSessionRegistry(opts: {
  serverName: string;
  logger: Logger;
}): SessionRegistry {
  const resources = new Map<SessionId, ResourceEntry>();
  const logger = opts.logger.child({ component: 'sessions' });

  async function readFile(): Promise<SessionsFile> {
    return stateRead(sessionsFilePath(), emptySessionsFile(), SessionsFileSchema);
  }

  async function mutateFile(
    mutator: (current: SessionsFile) => SessionsFile,
  ): Promise<SessionsFile> {
    return stateUpdate(sessionsFilePath(), emptySessionsFile(), SessionsFileSchema, mutator);
  }

  function buildEntry(uri: string, clientName: string): ResourceEntry {
    const resource = new SessionResource<VmServiceClient>(
      async () => {
        const client = new VmServiceClient(uri, { clientName });
        await client.connect();
        for (const stream of ['Logging', 'Stdout', 'Stderr', 'Extension', 'Isolate']) {
          try {
            await client.streamListen(stream);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/already subscribed/i.test(msg)) {
              logger.debug('streamListen failed', { stream, err: msg });
            }
          }
        }
        return client;
      },
      async (client) => {
        try {
          await client.dispose();
        } catch (err) {
          logger.debug('client.dispose threw', { err: String(err) });
        }
      },
    );
    return { resource, clientName };
  }

  async function get(id: SessionId): Promise<Session> {
    const file = await readFile();
    const session = file.sessions.find((s) => s.id === id);
    if (!session) throw new SessionNotFoundError(id);
    if (session.status === 'terminated') {
      throw new SessionTerminatedError(id, session.terminationReason);
    }
    return session;
  }

  async function attach(attachOpts: AttachOptions): Promise<Session> {
    const id = randomUUID();
    const now = Date.now();
    const clientName = makeClientName(opts.serverName);
    const newSession: Session = {
      id,
      uri: attachOpts.uri,
      source: attachOpts.source,
      clientName,
      attachedAt: now,
      lastSeenAt: now,
      status: 'attaching',
      ...(attachOpts.rawVmUri !== undefined ? { rawVmUri: attachOpts.rawVmUri } : {}),
      ...(attachOpts.pid !== undefined ? { pid: attachOpts.pid } : {}),
      ...(attachOpts.projectRoot !== undefined ? { projectRoot: attachOpts.projectRoot } : {}),
      ...(attachOpts.device !== undefined ? { device: attachOpts.device } : {}),
      ...(attachOpts.appName !== undefined ? { appName: attachOpts.appName } : {}),
    };

    await mutateFile((current) => ({
      ...current,
      sessions: [
        ...current.sessions.filter((s) => s.uri !== attachOpts.uri || s.status === 'terminated'),
        newSession,
      ],
    }));
    resources.set(id, buildEntry(attachOpts.uri, clientName));

    try {
      const entry = resources.get(id)!;
      const client = await entry.resource.acquire();
      try {
        const vm = await client.getVM();
        const isolateIds = vm.isolates.map((i) => i.id);
        await mutateFile((current) => ({
          ...current,
          sessions: current.sessions.map((s) =>
            s.id === id
              ? { ...s, status: 'ready' as const, isolateIds, lastSeenAt: Date.now() }
              : s,
          ),
        }));
        logger.info('session attached', {
          id,
          uri: attachOpts.uri,
          source: attachOpts.source,
          isolates: isolateIds.length,
        });
      } finally {
        await entry.resource.release();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await mutateFile((current) => ({
        ...current,
        sessions: current.sessions.map((s) =>
          s.id === id ? { ...s, status: 'stale' as const, terminationReason: msg } : s,
        ),
      }));
      logger.warn('initial attach failed', { id, err: msg });
      throw err;
    }

    const finalFile = await readFile();
    return finalFile.sessions.find((s) => s.id === id)!;
  }

  async function detach(id: SessionId, reason?: string): Promise<void> {
    const entry = resources.get(id);
    if (entry) {
      while (entry.resource.count > 0) {
        await entry.resource.release();
      }
      resources.delete(id);
    }
    await mutateFile((current) => ({
      ...current,
      sessions: current.sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              status: 'terminated' as const,
              terminatedAt: Date.now(),
              ...(reason !== undefined ? { terminationReason: reason } : {}),
            }
          : s,
      ),
    }));
    logger.info('session detached', { id, reason });
  }

  async function markStatus(
    id: SessionId,
    status: Session['status'],
    reason?: string,
  ): Promise<Session> {
    const next = await mutateFile((current) => ({
      ...current,
      sessions: current.sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              status,
              lastSeenAt: Date.now(),
              ...(reason !== undefined ? { terminationReason: reason } : {}),
            }
          : s,
      ),
    }));
    const session = next.sessions.find((s) => s.id === id);
    if (!session) throw new SessionNotFoundError(id);
    return session;
  }

  async function list(): Promise<Session[]> {
    return (await readFile()).sessions;
  }

  async function findActiveByTarget(
    projectRoot: string,
    device: string,
  ): Promise<Session | undefined> {
    const wantRoot = normalizeProjectRoot(projectRoot);
    const file = await readFile();
    const matches = file.sessions.filter(
      (s) =>
        s.status !== 'terminated' &&
        s.projectRoot !== undefined &&
        normalizeProjectRoot(s.projectRoot) === wantRoot &&
        s.device === device,
    );
    if (matches.length === 0) return undefined;
    return matches.reduce((newest, s) => (s.attachedAt > newest.attachedAt ? s : newest));
  }

  async function acquireClient(id: SessionId): Promise<AcquiredClient> {
    const session = await get(id);
    let entry = resources.get(id);
    if (!entry) {
      entry = buildEntry(session.uri, session.clientName);
      resources.set(id, entry);
    }
    const client = await entry.resource.acquire();
    return {
      client,
      release: () => entry!.resource.release(),
    };
  }

  async function shutdown(): Promise<void> {
    const ids = Array.from(resources.keys());
    for (const id of ids) {
      const entry = resources.get(id)!;
      while (entry.resource.count > 0) {
        await entry.resource.release();
      }
    }
    resources.clear();
  }

  return { attach, detach, get, list, findActiveByTarget, markStatus, acquireClient, shutdown };
}
