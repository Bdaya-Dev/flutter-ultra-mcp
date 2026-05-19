// extract_video_frame — extract a single PNG frame from a WebM/MP4 test failure video.
// Uses ffmpeg (must be in PATH). Duration probing for percent-based seek uses ffprobe.

import { spawn } from 'node:child_process';
import { z } from 'zod';
import { defineTool } from './types.js';

// Note: .refine() produces ZodEffects, not ZodObject, which breaks the server's
// isinstance check. Mutual-exclusion is enforced in the handler instead.
const inputSchema = z.object({
  videoPath: z.string().min(1).describe('Absolute path to the video file.'),
  timestampMs: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Timestamp in ms to extract. Mutually exclusive with percent.'),
  percent: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      'Extract frame at this % of duration (0=start, 100=end). Mutually exclusive with timestampMs.',
    ),
  outputPath: z.string().optional().describe('Output PNG path. Defaults to <videoPath>.frame.png.'),
});

function runCommand(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    proc.on('error', () =>
      resolve({ stdout, stderr: stderr + `spawn failed for ${cmd}`, code: 127 }),
    );
  });
}

async function probeDurationSeconds(videoPath: string): Promise<number | null> {
  const result = await runCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    videoPath,
  ]);
  if (result.code !== 0) return null;
  const val = parseFloat(result.stdout.trim());
  return isNaN(val) ? null : val;
}

export const extractVideoFrameTool = defineTool({
  name: 'extract_video_frame',
  description:
    'Extract a single frame from a test failure video (WebM/MP4) as PNG. Requires ffmpeg in PATH.',
  inputSchema,
  async handler(input, _ctx) {
    const output = input.outputPath ?? `${input.videoPath}.frame.png`;

    // Mutual-exclusion guard (can't use .refine() — it wraps ZodObject in ZodEffects).
    if (input.timestampMs !== undefined && input.percent !== undefined) {
      return {
        ok: false,
        error: 'timestampMs and percent are mutually exclusive — provide at most one.',
      };
    }

    // Verify ffmpeg is available.
    const versionCheck = await runCommand('ffmpeg', ['-version']);
    if (versionCheck.code === 127) {
      return { ok: false, error: 'ffmpeg not found in PATH' };
    }

    let seekSeconds: number | null = null;

    if (input.timestampMs !== undefined) {
      seekSeconds = input.timestampMs / 1000;
    } else if (input.percent !== undefined) {
      const duration = await probeDurationSeconds(input.videoPath);
      if (duration === null) {
        return {
          ok: false,
          error: 'ffprobe failed to read video duration — check videoPath and ffprobe availability',
        };
      }
      seekSeconds = (duration * input.percent) / 100;
    }
    // Neither specified → seek near end.

    const ffmpegArgs: string[] = [];
    if (seekSeconds !== null) {
      ffmpegArgs.push('-ss', String(seekSeconds));
    } else {
      ffmpegArgs.push('-sseof', '-0.1');
    }
    ffmpegArgs.push('-i', input.videoPath, '-frames:v', '1', '-update', '1', '-y', output);

    const result = await runCommand('ffmpeg', ffmpegArgs);
    if (result.code !== 0) {
      return {
        ok: false,
        error: `ffmpeg exited with code ${result.code}`,
        stderr: result.stderr.slice(-2000),
      };
    }

    const actualMs = seekSeconds !== null ? Math.round(seekSeconds * 1000) : null;
    return { ok: true, imagePath: output, timestampMs: actualMs };
  },
});
