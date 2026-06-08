// stop_patrol_recording — finalize the active recording.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { defineTool } from './types.js';

function mimeTypeForExt(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function waitForFile(
  filePath: string,
  timeoutMs: number,
  intervalMs: number,
  afterMs?: number,
): Promise<boolean> {
  const isFresh = (p: string): boolean => {
    if (!existsSync(p)) return false;
    if (afterMs === undefined) return true;
    try {
      return statSync(p).mtimeMs >= afterMs;
    } catch {
      return false;
    }
  };
  return new Promise((resolve) => {
    if (isFresh(filePath)) {
      resolve(true);
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (isFresh(filePath)) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        resolve(false);
      }
    }, intervalMs);
  });
}

export const stopPatrolRecordingTool = defineTool({
  name: 'stop_patrol_recording',
  description:
    'Stop the active Patrol screen recording. Returns the on-disk path the recorder finalized to (as previously supplied to start_patrol_recording). Optionally returns the recording as a base64 string.',
  inputSchema: z.object({
    returnBase64: z
      .boolean()
      .optional()
      .describe(
        'When true, read the saved recording file and include its base64 content in the response.',
      ),
  }),
  async handler(input, ctx) {
    const session = ctx.develop.get();
    if (!session) return { ok: false, reason: 'no_develop_session' };
    const stopRequestedAt = ctx.now();
    const sent = ctx.develop.send('recording stop');
    if (!sent) return { ok: false, reason: 'stdin_closed' };

    const outputPath = ctx.develop.lastRecordingPath;

    const base = {
      ok: true,
      taskId: session.id,
      ...(outputPath ? { outputPath } : {}),
      dispatchedAt: ctx.now(),
    };

    if (input.returnBase64 && !outputPath) {
      return { ...base, base64: null, base64Error: 'no_recording_path' };
    }

    if (input.returnBase64 && outputPath) {
      const resolvedPath = resolve(outputPath);
      const allowedExts = ['.gif', '.webm', '.mp4'];
      if (!allowedExts.some((ext) => resolvedPath.toLowerCase().endsWith(ext))) {
        return { ...base, base64: null, base64Error: 'invalid_file_extension' };
      }
      const found = await waitForFile(resolvedPath, 10_000, 500, stopRequestedAt);
      if (found) {
        try {
          const data = readFileSync(resolvedPath);
          return {
            ...base,
            base64: data.toString('base64'),
            mimeType: mimeTypeForExt(resolvedPath),
          };
        } catch {
          return { ...base, base64: null, base64Error: 'read_failed' };
        }
      }
      return { ...base, base64: null, base64Error: 'file_not_written_within_timeout' };
    }

    return base;
  },
});
