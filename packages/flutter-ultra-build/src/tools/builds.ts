/**
 * Build tools (plan §5.1 — Builds, all MARATHON split-tool):
 *
 *   start_build_apk, start_build_appbundle, start_build_ipa, start_build_web,
 *   start_build_windows, start_build_macos, start_build_linux
 *
 * Each with poll/get/cancel siblings. Platform-locked builds (ipa on Mac,
 * windows on Win, macos on Mac, linux on Linux) early-error with a clear
 * message rather than spawning a guaranteed-failing process.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err, errFromException } from '../runtime/result.js';
import { resolveCli } from '../util/cli.js';
import { loadProject } from '../util/project.js';
import {
  cancelJob,
  readJob,
  readStdoutTail,
  startJob,
  type JobProgress,
  type ProgressParser,
} from '../runtime/jobs.js';

type Platform = 'apk' | 'appbundle' | 'ipa' | 'web' | 'windows' | 'macos' | 'linux';

interface PlatformGuard {
  platform: Platform;
  /** Required OS, undefined = any. */
  requiredOs?: NodeJS.Platform[];
  /** Default artifact path relative to project root. */
  artifactGlob: string;
}

const GUARDS: Record<Platform, PlatformGuard> = {
  apk: { platform: 'apk', artifactGlob: 'build/app/outputs/flutter-apk' },
  appbundle: { platform: 'appbundle', artifactGlob: 'build/app/outputs/bundle' },
  ipa: { platform: 'ipa', requiredOs: ['darwin'], artifactGlob: 'build/ios/ipa' },
  web: { platform: 'web', artifactGlob: 'build/web' },
  windows: {
    platform: 'windows',
    requiredOs: ['win32'],
    artifactGlob: 'build/windows/x64/runner/Release',
  },
  macos: {
    platform: 'macos',
    requiredOs: ['darwin'],
    artifactGlob: 'build/macos/Build/Products/Release',
  },
  linux: {
    platform: 'linux',
    requiredOs: ['linux'],
    artifactGlob: 'build/linux/x64/release/bundle',
  },
};

class BuildProgressParser implements ProgressParser {
  parse(line: string): JobProgress | undefined {
    if (/Running Gradle task/.test(line)) return { stage: 'gradle' };
    if (/Running Xcode build/.test(line)) return { stage: 'xcode' };
    if (/Compiling, linking and signing/.test(line)) return { stage: 'linking' };
    if (/✓ Built /.test(line)) return { stage: 'completed', fraction: 1, message: line.trim() };
    return undefined;
  }
}

interface BuildArgs {
  root: string;
  mode?: 'debug' | 'profile' | 'release';
  flavor?: string;
  target?: string;
  dartDefines?: Record<string, string>;
  splitDebugInfo?: string;
  obfuscate?: boolean;
  // web-specific
  webRenderer?: 'canvaskit' | 'html' | 'auto';
  baseHref?: string;
  pwaStrategy?: 'offline-first' | 'none';
  // ios-specific
  noCodesign?: boolean;
  exportMethod?: 'app-store' | 'ad-hoc' | 'enterprise' | 'development';
}

function commonBuildArgsShape() {
  return {
    root: z.string().min(1).describe('Absolute path to a Flutter project.'),
    mode: z.enum(['debug', 'profile', 'release']).optional().default('release'),
    flavor: z.string().optional(),
    target: z.string().optional().describe('Entrypoint, e.g. lib/main_production.dart.'),
    dartDefines: z.record(z.string(), z.string()).optional(),
    splitDebugInfo: z.string().optional().describe('Directory to write split debug-info symbols.'),
    obfuscate: z.boolean().optional().default(false),
  } as const;
}

function platformLockError(plat: Platform): string {
  const guard = GUARDS[plat];
  if (!guard.requiredOs) return '';
  if (guard.requiredOs.includes(process.platform)) return '';
  return `Build target '${plat}' is only supported on ${guard.requiredOs.join('/')}. Current platform: ${process.platform}.`;
}

function flutterBuildArgs(plat: Platform, args: BuildArgs): string[] {
  const out: string[] = ['build', plat];
  if (args.mode) out.push(`--${args.mode}`);
  if (args.flavor) out.push('--flavor', args.flavor);
  if (args.target) out.push('--target', args.target);
  for (const [k, v] of Object.entries(args.dartDefines ?? {})) out.push(`--dart-define=${k}=${v}`);
  if (args.obfuscate && args.splitDebugInfo) {
    out.push('--obfuscate', '--split-debug-info', args.splitDebugInfo);
  } else if (args.splitDebugInfo) {
    out.push('--split-debug-info', args.splitDebugInfo);
  }
  if (plat === 'web') {
    if (args.webRenderer) out.push(`--web-renderer=${args.webRenderer}`);
    if (args.baseHref) out.push(`--base-href=${args.baseHref}`);
    if (args.pwaStrategy) out.push(`--pwa-strategy=${args.pwaStrategy}`);
  }
  if (plat === 'ipa') {
    if (args.noCodesign) out.push('--no-codesign');
    if (args.exportMethod) out.push(`--export-method=${args.exportMethod}`);
  }
  return out;
}

function locateArtifacts(root: string, plat: Platform): string[] {
  const glob = GUARDS[plat].artifactGlob;
  const dir = join(root, glob);
  if (!existsSync(dir)) return [];
  try {
    const entries = readdirSync(dir);
    return entries.map((e) => join(dir, e)).filter((p) => statSync(p).isFile());
  } catch {
    return [];
  }
}

function registerPlatform(server: McpServer, plat: Platform): void {
  const startName = `start_build_${plat}`;
  const pollName = `poll_build_${plat}_job`;
  const getName = `get_build_${plat}_result`;
  const cancelName = `cancel_build_${plat}_job`;

  // Build a per-platform schema with the right extras present.
  const extras: Record<string, z.ZodTypeAny> = {};
  if (plat === 'web') {
    extras['webRenderer'] = z.enum(['canvaskit', 'html', 'auto']).optional();
    extras['baseHref'] = z.string().optional();
    extras['pwaStrategy'] = z.enum(['offline-first', 'none']).optional();
  }
  if (plat === 'ipa') {
    extras['noCodesign'] = z.boolean().optional().default(false);
    extras['exportMethod'] = z
      .enum(['app-store', 'ad-hoc', 'enterprise', 'development'])
      .optional();
  }

  defineTool<BuildArgs>(server, {
    name: startName,
    description: `MARATHON split-tool — start \`flutter build ${plat}\`. Returns {jobId}. See poll/get/cancel siblings.`,
    inputSchema: { ...commonBuildArgsShape(), ...extras },
    watchdog: { name: startName, ceilingMs: 15_000, toolClass: 'quick' },
    handler: async (args) => {
      try {
        const lock = platformLockError(plat);
        if (lock) return err(lock);
        const proj = loadProject(args.root);
        const cli = resolveCli('flutter');
        const cmdArgs = flutterBuildArgs(plat, args);
        const job = startJob({
          jobType: `build_${plat}`,
          cmd: cli,
          args: cmdArgs,
          cwd: proj.root,
          progressParser: new BuildProgressParser(),
        });
        return okJson({ jobId: job.jobId, status: job.record.status, cmd: cli, args: cmdArgs });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ jobId: string; tailBytes?: number }>(server, {
    name: pollName,
    description: `Poll a ${plat} build job; returns status + progress + stdoutTail.`,
    inputSchema: {
      jobId: z.string().min(1),
      tailBytes: z
        .number()
        .int()
        .min(0)
        .max(256 * 1024)
        .optional()
        .default(16 * 1024),
    },
    watchdog: { name: pollName, ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId, tailBytes }) => {
      const rec = readJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      return okJson({ ...rec, stdoutTail: readStdoutTail(jobId, tailBytes ?? 16 * 1024) });
    },
  });

  defineTool<{ jobId: string }>(server, {
    name: getName,
    description: `Get final result for a completed ${plat} build job. Lists artifact paths discovered under the platform's standard output directory.`,
    inputSchema: { jobId: z.string().min(1) },
    watchdog: { name: getName, ceilingMs: 15_000, toolClass: 'quick' },
    handler: async ({ jobId }) => {
      const rec = readJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      if (rec.status === 'running' || rec.status === 'pending') {
        return err(`Job '${jobId}' is still ${rec.status}.`);
      }
      const artifacts = locateArtifacts(rec.cwd, plat);
      return okJson({ ...rec, artifacts, stdout: readStdoutTail(jobId, 256 * 1024) });
    },
  });

  defineTool<{ jobId: string }>(server, {
    name: cancelName,
    description: `Cancel an in-flight ${plat} build job.`,
    inputSchema: { jobId: z.string().min(1) },
    watchdog: { name: cancelName, ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId }) => {
      const rec = cancelJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      return okJson({ status: rec.status });
    },
  });
}

export function register(server: McpServer): void {
  registerPlatform(server, 'apk');
  registerPlatform(server, 'appbundle');
  registerPlatform(server, 'ipa');
  registerPlatform(server, 'web');
  registerPlatform(server, 'windows');
  registerPlatform(server, 'macos');
  registerPlatform(server, 'linux');
}
