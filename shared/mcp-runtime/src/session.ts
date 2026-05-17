// Cross-server session model shared by runtime + gesture + devtools + patrol.
//
// Sessions live on disk so:
//   - runtime crashes don't lose session state (gesture can re-attach)
//   - other servers can read without IPC (just read the file)
//
// Runtime server owns CRUD (writes). Other servers must only read.

import { z } from 'zod';

export const SessionStatusSchema = z.enum(['attaching', 'ready', 'stale', 'terminated']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSourceSchema = z.enum(['manual', 'launched', 'discovered']);
export type SessionSource = z.infer<typeof SessionSourceSchema>;

export const SessionIdSchema = z
  .string()
  .min(8)
  .describe('UUIDv4 session identifier. Stable for the session lifetime.');
export type SessionId = z.infer<typeof SessionIdSchema>;

export const SessionSchema = z
  .object({
    id: SessionIdSchema,
    uri: z.string().describe('DDS-resolved ws:// URI (post-redirect, includes /ws path).'),
    rawVmUri: z.string().optional().describe('Pre-DDS raw VM service URI if known.'),
    source: SessionSourceSchema,
    clientName: z.string().describe('DDS multi-client name. Format: flutter-ultra/<server>/<pid>.'),
    attachedAt: z.number().int(),
    lastSeenAt: z.number().int(),
    status: SessionStatusSchema,
    pid: z
      .number()
      .int()
      .optional()
      .describe('PID of the dartvm.exe / dart hosting the isolate, if known.'),
    projectRoot: z.string().optional(),
    device: z
      .string()
      .optional()
      .describe('Device id: chrome / windows / android-<id> / ios-<uuid>.'),
    isolateIds: z.array(z.string()).optional(),
    appName: z.string().optional(),
    terminatedAt: z.number().int().optional(),
    terminationReason: z.string().optional(),
  })
  .strict();
export type Session = z.infer<typeof SessionSchema>;

export const SessionsFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessions: z.array(SessionSchema),
  })
  .strict();
export type SessionsFile = z.infer<typeof SessionsFileSchema>;

export function emptySessionsFile(): SessionsFile {
  return { schemaVersion: 1, sessions: [] };
}

export function makeClientName(server: string): string {
  return `flutter-ultra/${server}/${process.pid}`;
}

// SessionResource: reference-counted holder per plan §17.10.
//
// Two tool calls against the same sessionId share one underlying resource
// (e.g. a VmServiceClient WebSocket). Last release closes.
export class SessionResource<T> {
  private refCount = 0;
  private resource: Promise<T> | null = null;
  private resolvedResource: T | null = null;
  private disposing: Promise<void> | null = null;

  constructor(
    private readonly factory: () => Promise<T>,
    private readonly destructor: (r: T) => Promise<void>,
  ) {}

  async acquire(): Promise<T> {
    if (this.disposing) {
      // Wait for previous disposal to finish before re-acquiring.
      await this.disposing;
      this.disposing = null;
    }
    this.refCount += 1;
    if (!this.resource) {
      this.resource = this.factory().then((r) => {
        this.resolvedResource = r;
        return r;
      });
    }
    return this.resource;
  }

  async release(): Promise<void> {
    if (this.refCount === 0) return;
    this.refCount -= 1;
    if (this.refCount === 0 && this.resolvedResource) {
      const r = this.resolvedResource;
      this.resource = null;
      this.resolvedResource = null;
      this.disposing = this.destructor(r);
      try {
        await this.disposing;
      } finally {
        this.disposing = null;
      }
    }
  }

  get count(): number {
    return this.refCount;
  }
}
