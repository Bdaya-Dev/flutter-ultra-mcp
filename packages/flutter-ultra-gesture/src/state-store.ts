// Read-only consumer of session state files written by flutter-ultra-runtime.
//
// File layout (per plan §4 + worker-E handoff):
//   ${STATE_DIR}/sessions.json          — { sessions: Session[] }
//   ${STATE_DIR}/session-<id>.json      — { id, uri, clientName, ... }
//
// This server never writes either file. Mutation is the runtime server's job.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

export const SessionStatusSchema = z.enum(['attaching', 'ready', 'stale', 'terminated']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  uri: z.string(),
  source: z.enum(['manual', 'launched', 'discovered']).optional(),
  clientName: z.string().optional(),
  attachedAt: z.number().optional(),
  status: SessionStatusSchema.optional(),
  pid: z.number().int().optional(),
  isolateIds: z.array(z.string()).optional(),
});
export type Session = z.infer<typeof SessionSchema>;

export const SessionsFileSchema = z.object({
  sessions: z.array(SessionSchema).default([]),
});

export function defaultStateDir(): string {
  return (
    process.env.FLUTTER_ULTRA_STATE_DIR ??
    join(process.env.FLUTTER_ULTRA_DATA ?? join(homedir(), '.flutter-ultra-mcp'), 'state')
  );
}

export async function readSessionsFile(stateDir: string): Promise<Session[]> {
  try {
    const raw = await readFile(join(stateDir, 'sessions.json'), 'utf8');
    const parsed = SessionsFileSchema.parse(JSON.parse(raw));
    return parsed.sessions;
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function readSession(stateDir: string, sessionId: string): Promise<Session | null> {
  // Per-session file is canonical for the URI. Fall back to scanning sessions.json
  // if the per-session file doesn't exist (older runtime server versions).
  try {
    const raw = await readFile(join(stateDir, `session-${sessionId}.json`), 'utf8');
    return SessionSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const sessions = await readSessionsFile(stateDir);
  return sessions.find((s) => s.id === sessionId) ?? null;
}
