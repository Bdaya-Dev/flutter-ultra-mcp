/**
 * Recording conversion tool: convert_recording
 *
 * Uses system ffmpeg to convert device/browser recordings to MP4, WebM, or GIF.
 * GIF uses two-pass palette generation for quality output.
 */

import { z } from 'zod';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err } from '../runtime/result.js';
import { spawnCapture } from '../runtime/spawn.js';

const FFMPEG_NOT_FOUND_HINT =
  'ffmpeg is not installed or not on PATH. Install it: https://ffmpeg.org/download.html (macOS: brew install ffmpeg, Ubuntu: apt install ffmpeg, Windows: winget install Gyan.FFmpeg)';

function resolveFfmpeg(): string {
  const envOverride = process.env['FLUTTER_ULTRA_FFMPEG_BIN'];
  if (envOverride && envOverride.length > 0) return envOverride;
  const which = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(which, ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return 'ffmpeg'; // let spawnCapture fail with a clear message
  const line = res.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
  return line?.trim() ?? 'ffmpeg';
}

async function checkFfmpeg(ffmpegPath: string, signal: AbortSignal): Promise<boolean> {
  try {
    const result = await spawnCapture({
      cmd: ffmpegPath,
      args: ['-version'],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      signal,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function getFileSizeBytes(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}

export function register(server: McpServer): void {
  defineTool<{
    inputPath: string;
    outputPath: string;
    outputFormat: 'mp4' | 'webm' | 'gif';
    maxWidth?: number;
    fps?: number;
    quality?: number;
  }>(server, {
    name: 'convert_recording',
    description:
      'Convert a video recording (MP4/WebM/MOV) to another format using system ffmpeg. GIF uses two-pass palette generation for quality. Returns output path and file size.',
    inputSchema: {
      inputPath: z
        .string()
        .min(1)
        .describe('Absolute path to the source video file (MP4, WebM, MOV, etc.).'),
      outputPath: z
        .string()
        .min(1)
        .describe('Absolute path for the converted output file. Extension should match format.'),
      outputFormat: z
        .enum(['mp4', 'webm', 'gif'])
        .describe('Target output format. gif uses two-pass palette generation.'),
      maxWidth: z
        .number()
        .int()
        .positive()
        .max(3840)
        .optional()
        .describe('Scale video to this max width in pixels, preserving aspect ratio.'),
      fps: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe('Output frames per second. Defaults: gif=10, mp4/webm=source fps.'),
      quality: z
        .number()
        .int()
        .min(0)
        .max(51)
        .optional()
        .describe(
          'CRF quality for mp4 (0=lossless, 23=default, 51=worst) / webm (0-63, lower=better). Ignored for gif.',
        ),
    },
    watchdog: { name: 'convert_recording', ceilingMs: 10 * 60_000, toolClass: 'long' },
    handler: async ({ inputPath, outputPath, outputFormat, maxWidth, fps, quality }, ctx) => {
      try {
        const ffmpegPath = resolveFfmpeg();
        const available = await checkFfmpeg(ffmpegPath, ctx.signal);
        if (!available) {
          return err('ffmpeg not found', FFMPEG_NOT_FOUND_HINT);
        }

        await mkdir(dirname(outputPath), { recursive: true });

        if (outputFormat === 'gif') {
          // Two-pass GIF: generate palette then apply it.
          const gifFps = fps ?? 10;
          const scaleFilter = maxWidth
            ? `fps=${gifFps},scale=${maxWidth}:-1:flags=lanczos`
            : `fps=${gifFps},scale=-1:-1:flags=lanczos`;

          // Pass 1: generate palette
          const palettePath = outputPath + '.palette.png';
          const pass1 = await spawnCapture({
            cmd: ffmpegPath,
            args: ['-i', inputPath, '-vf', `${scaleFilter},palettegen`, '-y', palettePath],
            cwd: process.cwd(),
            timeoutMs: 5 * 60_000,
            signal: ctx.signal,
          });
          if (pass1.exitCode !== 0) {
            return err(
              `convert_recording (gif pass 1) failed with exit ${String(pass1.exitCode)}`,
              pass1.stderr.slice(-2000) || pass1.stdout.slice(-2000),
            );
          }

          // Pass 2: apply palette
          const pass2 = await spawnCapture({
            cmd: ffmpegPath,
            args: [
              '-i',
              inputPath,
              '-i',
              palettePath,
              '-lavfi',
              `${scaleFilter}[x];[x][1:v]paletteuse`,
              '-y',
              outputPath,
            ],
            cwd: process.cwd(),
            timeoutMs: 5 * 60_000,
            signal: ctx.signal,
          });

          // Best-effort palette cleanup (non-fatal).
          spawnCapture({
            cmd: process.platform === 'win32' ? 'cmd' : 'rm',
            args: process.platform === 'win32' ? ['/c', 'del', palettePath] : ['-f', palettePath],
            cwd: process.cwd(),
            timeoutMs: 5_000,
            signal: ctx.signal,
          }).catch(() => undefined);

          if (pass2.exitCode !== 0) {
            return err(
              `convert_recording (gif pass 2) failed with exit ${String(pass2.exitCode)}`,
              pass2.stderr.slice(-2000) || pass2.stdout.slice(-2000),
            );
          }
        } else if (outputFormat === 'mp4') {
          const vfParts: string[] = [];
          if (fps) vfParts.push(`fps=${fps}`);
          if (maxWidth) vfParts.push(`scale=${maxWidth}:-2`);
          const args = ['-i', inputPath];
          if (vfParts.length > 0) args.push('-vf', vfParts.join(','));
          args.push('-c:v', 'libx264', '-preset', 'fast');
          args.push('-crf', String(quality ?? 23));
          args.push('-movflags', '+faststart', '-y', outputPath);

          const result = await spawnCapture({
            cmd: ffmpegPath,
            args,
            cwd: process.cwd(),
            timeoutMs: 5 * 60_000,
            signal: ctx.signal,
          });
          if (result.exitCode !== 0) {
            return err(
              `convert_recording (mp4) failed with exit ${String(result.exitCode)}`,
              result.stderr.slice(-2000) || result.stdout.slice(-2000),
            );
          }
        } else {
          // webm
          const vfParts: string[] = [];
          if (fps) vfParts.push(`fps=${fps}`);
          if (maxWidth) vfParts.push(`scale=${maxWidth}:-2`);
          const args = ['-i', inputPath];
          if (vfParts.length > 0) args.push('-vf', vfParts.join(','));
          args.push('-c:v', 'libvpx-vp9');
          args.push('-crf', String(quality ?? 30), '-b:v', '0');
          args.push('-y', outputPath);

          const result = await spawnCapture({
            cmd: ffmpegPath,
            args,
            cwd: process.cwd(),
            timeoutMs: 5 * 60_000,
            signal: ctx.signal,
          });
          if (result.exitCode !== 0) {
            return err(
              `convert_recording (webm) failed with exit ${String(result.exitCode)}`,
              result.stderr.slice(-2000) || result.stdout.slice(-2000),
            );
          }
        }

        const sizeBytes = await getFileSizeBytes(outputPath);
        return okJson({ outputPath, sizeBytes, format: outputFormat });
      } catch (e) {
        return err(
          `convert_recording failed: ${e instanceof Error ? e.message : String(e)}`,
          FFMPEG_NOT_FOUND_HINT,
        );
      }
    },
  });
}
