/**
 * Code-generation tools (plan §5.1 — Codegen):
 *
 *   start_build_runner_build / poll_build_runner_job / get_build_runner_result / cancel_build_runner_job
 *   start_build_runner_watch / poll_build_runner_watch / stop_build_runner_watch
 *   flutter_gen_l10n
 *
 * build_runner_build and build_runner_watch are MARATHON split-tool —
 * see plan §17.5. Watch mode reuses the same job store but is queried via
 * stream cursor (`since` jobline index).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err, errFromException } from '../runtime/result.js';
import { spawnCapture } from '../runtime/spawn.js';
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

const rootArg = z.string().min(1).describe('Absolute path to a project root or descendant.');

class BuildRunnerProgressParser implements ProgressParser {
  parse(line: string): JobProgress | undefined {
    if (line.includes('[INFO] Generating build script')) return { stage: 'generating-script' };
    if (line.includes('[INFO] Running build')) return { stage: 'running-build' };
    const m = line.match(/\[INFO\] Build completed successfully in (.+)/);
    if (m) return { stage: 'completed', fraction: 1, message: `Completed in ${m[1]}` };
    if (line.includes('[SEVERE]')) return { stage: 'errored', message: line.trim() };
    return undefined;
  }
}

export function register(server: McpServer): void {
  // ─── build_runner build (split-tool) ──────────────────────────────────────

  defineTool<{ root: string; deleteConflictingOutputs?: boolean; verbose?: boolean }>(server, {
    name: 'start_build_runner_build',
    description:
      'MARATHON split-tool — start `dart run build_runner build` as a background worker. Returns {jobId}. Use poll_build_runner_job / get_build_runner_result / cancel_build_runner_job.',
    inputSchema: {
      root: rootArg,
      deleteConflictingOutputs: z.boolean().optional().default(true),
      verbose: z.boolean().optional().default(false),
    },
    watchdog: { name: 'start_build_runner_build', ceilingMs: 15_000, toolClass: 'quick' },
    handler: async ({ root, deleteConflictingOutputs, verbose }) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
        const cmdArgs = ['run', 'build_runner', 'build'];
        if (deleteConflictingOutputs) cmdArgs.push('--delete-conflicting-outputs');
        if (verbose) cmdArgs.push('--verbose');
        const job = startJob({
          jobType: 'build_runner_build',
          cmd: cli,
          args: cmdArgs,
          cwd: proj.root,
          progressParser: new BuildRunnerProgressParser(),
        });
        return okJson({ jobId: job.jobId, status: job.record.status, cmd: cli, args: cmdArgs });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ jobId: string; tailBytes?: number }>(server, {
    name: 'poll_build_runner_job',
    description: 'Poll a build_runner_build job. Returns {status, progress, stdoutTail}.',
    inputSchema: {
      jobId: z.string().min(1),
      tailBytes: z
        .number()
        .int()
        .min(0)
        .max(256 * 1024)
        .optional()
        .default(8 * 1024),
    },
    watchdog: { name: 'poll_build_runner_job', ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId, tailBytes }) => {
      const rec = readJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      return okJson({ ...rec, stdoutTail: readStdoutTail(jobId, tailBytes ?? 8 * 1024) });
    },
  });

  defineTool<{ jobId: string }>(server, {
    name: 'get_build_runner_result',
    description:
      'Get final result for a completed build_runner_build job. Errors if still running.',
    inputSchema: { jobId: z.string().min(1) },
    watchdog: { name: 'get_build_runner_result', ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId }) => {
      const rec = readJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      if (rec.status === 'running' || rec.status === 'pending') {
        return err(
          `Job '${jobId}' is still ${rec.status}.`,
          'Poll until status is completed/failed/cancelled.',
        );
      }
      return okJson({ ...rec, stdout: readStdoutTail(jobId, 256 * 1024) });
    },
  });

  defineTool<{ jobId: string }>(server, {
    name: 'cancel_build_runner_job',
    description: 'Cancel an in-flight build_runner_build job.',
    inputSchema: { jobId: z.string().min(1) },
    watchdog: { name: 'cancel_build_runner_job', ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId }) => {
      const rec = cancelJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      return okJson({ status: rec.status });
    },
  });

  // ─── build_runner watch (split-tool, continuous) ──────────────────────────

  defineTool<{ root: string; deleteConflictingOutputs?: boolean }>(server, {
    name: 'start_build_runner_watch',
    description:
      'Continuous split-tool — start `dart run build_runner watch` as a background worker. Returns {jobId}. Poll with poll_build_runner_watch; stop with stop_build_runner_watch.',
    inputSchema: {
      root: rootArg,
      deleteConflictingOutputs: z.boolean().optional().default(true),
    },
    watchdog: { name: 'start_build_runner_watch', ceilingMs: 15_000, toolClass: 'quick' },
    handler: async ({ root, deleteConflictingOutputs }) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
        const cmdArgs = ['run', 'build_runner', 'watch'];
        if (deleteConflictingOutputs) cmdArgs.push('--delete-conflicting-outputs');
        const job = startJob({
          jobType: 'build_runner_watch',
          cmd: cli,
          args: cmdArgs,
          cwd: proj.root,
          progressParser: new BuildRunnerProgressParser(),
        });
        return okJson({ jobId: job.jobId, status: job.record.status });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ jobId: string; tailBytes?: number }>(server, {
    name: 'poll_build_runner_watch',
    description: 'Read the latest stdout tail + status from a build_runner_watch job.',
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
    watchdog: { name: 'poll_build_runner_watch', ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId, tailBytes }) => {
      const rec = readJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      return okJson({ ...rec, stdoutTail: readStdoutTail(jobId, tailBytes ?? 16 * 1024) });
    },
  });

  defineTool<{ jobId: string }>(server, {
    name: 'stop_build_runner_watch',
    description: 'Stop a build_runner_watch job and release its resources.',
    inputSchema: { jobId: z.string().min(1) },
    watchdog: { name: 'stop_build_runner_watch', ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId }) => {
      const rec = cancelJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      return okJson({ status: rec.status });
    },
  });

  // ─── flutter_gen_l10n ─────────────────────────────────────────────────────

  defineTool<{ root: string }>(server, {
    name: 'flutter_gen_l10n',
    description: 'Run `flutter gen-l10n` to generate Dart bindings from ARB files.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'flutter_gen_l10n', ceilingMs: 3 * 60_000, toolClass: 'long' },
    handler: async ({ root }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli('flutter');
        const result = await spawnCapture({
          cmd: cli,
          args: ['gen-l10n'],
          cwd: proj.root,
          timeoutMs: 3 * 60_000,
          signal: ctx.signal,
        });
        if (result.exitCode !== 0) {
          return err(
            `flutter gen-l10n failed: ${result.stderr.slice(-2048)}`,
            'Verify l10n.yaml and that base ARB is present.',
          );
        }
        return okJson({ exitCode: 0, durationMs: result.durationMs, stdout: result.stdout });
      } catch (e) {
        return errFromException(e);
      }
    },
  });
}
