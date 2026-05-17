// SessionRegistry — caches one VmServiceClient per active session id.
//
// Each call resolves the session via readSession(stateDir, id), opens a fresh
// VmServiceClient if needed with our own clientName so DDS treats us as a
// distinct client from the runtime server, then probes
// ext.flutter.ultra.getVersion on first use to fail-fast when the app does
// not include the ultra_flutter binding.

import { VmServiceClient } from '@flutter-ultra/vm-service-client';
import { defaultStateDir, readSession, type Session } from './state-store.js';

export interface SessionRegistryOptions {
  stateDir?: string;
  clientNamePrefix?: string;
}

export interface SessionHandle {
  session: Session;
  client: VmServiceClient;
  isolateId: string;
  ultraVersion: string;
}

interface CacheEntry {
  uri: string;
  client: VmServiceClient;
  isolateId?: string;
  ultraVersion?: string;
  versionProbed: boolean;
}

export class UltraNotRegisteredError extends Error {
  constructor(sessionId: string, cause?: unknown) {
    super(
      `Session ${sessionId} does not have the ultra_flutter binding registered. ` +
        `Add 'package:ultra_flutter' to the target app and initialise via ` +
        `'UltraFlutterBinding.ensureInitialized()' (or compose the mixin onto your ` +
        `WidgetsFlutterBinding subclass). See package README. ` +
        `Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'UltraNotRegisteredError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(
      `Session ${sessionId} is not in sessions.json. Use flutter-ultra-runtime/list_sessions to ` +
        `enumerate active sessions, or attach a new one via flutter-ultra-runtime/attach.`,
    );
    this.name = 'SessionNotFoundError';
  }
}

export class SessionRegistry {
  private readonly stateDir: string;
  private readonly clientNamePrefix: string;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: SessionRegistryOptions = {}) {
    this.stateDir = options.stateDir ?? defaultStateDir();
    this.clientNamePrefix = options.clientNamePrefix ?? 'flutter-ultra/gesture';
  }

  async resolve(sessionId: string): Promise<SessionHandle> {
    const session = await readSession(this.stateDir, sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    let entry = this.cache.get(sessionId);
    if (entry && entry.uri !== session.uri) {
      // URI rotated (hot restart / DDS reconnect). Drop stale client.
      await entry.client.dispose().catch(() => undefined);
      entry = undefined;
    }
    if (!entry) {
      const client = new VmServiceClient(session.uri, {
        clientName: `${this.clientNamePrefix}/${process.pid}`,
      });
      await client.connect();
      entry = { uri: session.uri, client, versionProbed: false };
      this.cache.set(sessionId, entry);
    }

    if (!entry.isolateId) {
      const vm = await entry.client.getVM();
      const isolateRef = vm.isolates?.[0];
      if (!isolateRef?.id) {
        throw new Error(
          `Session ${sessionId} has no isolates yet — the Flutter app may still be starting.`,
        );
      }
      entry.isolateId = isolateRef.id;
    }

    if (!entry.versionProbed) {
      try {
        const result = (await entry.client.callServiceExtension('ext.flutter.ultra.getVersion', {
          isolateId: entry.isolateId,
        })) as { version?: string } | null;
        entry.ultraVersion = result?.version ?? 'unknown';
        entry.versionProbed = true;
      } catch (error) {
        // Drop the cached client so a subsequent retry after the user fixes
        // the binding picks up a fresh connection.
        this.cache.delete(sessionId);
        await entry.client.dispose().catch(() => undefined);
        throw new UltraNotRegisteredError(sessionId, error);
      }
    }

    return {
      session,
      client: entry.client,
      isolateId: entry.isolateId,
      ultraVersion: entry.ultraVersion ?? 'unknown',
    };
  }

  async invalidate(sessionId: string): Promise<void> {
    const entry = this.cache.get(sessionId);
    if (!entry) return;
    this.cache.delete(sessionId);
    await entry.client.dispose().catch(() => undefined);
  }

  async disposeAll(): Promise<void> {
    const entries = Array.from(this.cache.values());
    this.cache.clear();
    await Promise.allSettled(entries.map((e) => e.client.dispose()));
  }
}
