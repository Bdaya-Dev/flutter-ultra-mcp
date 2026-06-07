// stop_patrol_recording — finalize the active recording.

import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { defineTool } from './types.js';

function mimeTypeForExt(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function waitForFile(filePath: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (existsSync(filePath)) {
      resolve(true);
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (existsSync(filePath)) {
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
    const sent = ctx.develop.send('recording stop');
    if (!sent) return { ok: false, reason: 'stdin_closed' };

    const outputPath = ctx.develop.lastRecordingPath;

    const base = {
      ok: true,
      taskId: session.id,
      ...(outputPath ? { outputPath } : {}),
      dispatchedAt: ctx.now(),
    };

    if (input.returnBase64 && outputPath) {
      const found = await waitForFile(outputPath, 10_000, 500);
      if (found) {
        try {
          const data = readFileSync(outputPath);
          return { ...base, base64: data.toString('base64'), mimeType: mimeTypeForExt(outputPath) };
        } catch {
          return { ...base, base64: null, base64Error: 'read_failed' };
        }
      }
      return { ...base, base64: null, base64Error: 'file_not_written_within_timeout' };
    }

    return base;
  },
});
