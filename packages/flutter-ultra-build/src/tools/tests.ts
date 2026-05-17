/**
 * Test tools (plan §5.1 — Tests, all split-tool MARATHON except test_filter):
 *
 *   start_run_unit_tests / poll_run_unit_tests / get_run_unit_tests_result / cancel_run_unit_tests
 *   start_run_widget_tests / ...
 *   start_run_integration_tests / ...
 *   start_run_golden_tests / ...    (Long, but split-tool for consistency)
 *   start_update_goldens / ...
 *   test_filter (Quick, sync) — list tests matching a regex without running
 *
 * `flutter test --reporter json` emits one JSON event per line, which we
 * parse for progress + final pass/fail counts.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

const rootArg = z.string().min(1).describe('Absolute path to a Flutter project root.');

class FlutterTestJsonParser implements ProgressParser {
  private completed = 0;
  parse(line: string): JobProgress | undefined {
    if (!line.startsWith('{')) return undefined;
    try {
      const evt = JSON.parse(line) as {
        type?: string;
        success?: boolean;
        test?: { name?: string };
      };
      switch (evt.type) {
        case 'allSuites':
          return { stage: 'starting' };
        case 'testStart':
          return evt.test?.name
            ? { stage: 'running', message: evt.test.name }
            : { stage: 'running' };
        case 'testDone':
          this.completed++;
          return { stage: 'running', filesProcessed: this.completed };
        case 'done':
          return {
            stage: 'done',
            fraction: 1,
            message: evt.success ? 'all passed' : 'some failed',
          };
      }
    } catch {
      // not JSON
    }
    return undefined;
  }
}

interface StartTestOptions {
  jobType: string;
  testRoot: string; // 'test' / 'test/widget' / 'integration_test'
}

function makeStartTool(options: StartTestOptions) {
  return async ({
    root,
    name,
    plainName,
    updateGoldens,
    dartDefines,
    flavor,
  }: {
    root: string;
    name?: string;
    plainName?: string;
    updateGoldens?: boolean;
    dartDefines?: Record<string, string>;
    flavor?: string;
  }) => {
    try {
      const proj = loadProject(root);
      const cli = resolveCli('flutter');
      const cmdArgs = ['test', '--reporter', 'json'];
      if (updateGoldens) cmdArgs.push('--update-goldens');
      if (flavor) cmdArgs.push('--flavor', flavor);
      if (dartDefines) {
        for (const [k, v] of Object.entries(dartDefines)) cmdArgs.push(`--dart-define=${k}=${v}`);
      }
      if (name) cmdArgs.push('--name', name);
      if (plainName) cmdArgs.push('--plain-name', plainName);
      if (existsSync(join(proj.root, options.testRoot))) cmdArgs.push(options.testRoot);
      const job = startJob({
        jobType: options.jobType,
        cmd: cli,
        args: cmdArgs,
        cwd: proj.root,
        progressParser: new FlutterTestJsonParser(),
      });
      return okJson({ jobId: job.jobId, status: job.record.status });
    } catch (e) {
      return errFromException(e);
    }
  };
}

const filterShape = {
  root: rootArg,
  name: z.string().optional().describe('Regex passed to flutter test --name.'),
  plainName: z.string().optional().describe('Substring passed to flutter test --plain-name.'),
  updateGoldens: z.boolean().optional().default(false),
  dartDefines: z
    .record(z.string(), z.string())
    .optional()
    .describe('Key/value pairs passed as --dart-define.'),
  flavor: z.string().optional(),
} as const;

const pollShape = {
  jobId: z.string().min(1),
  tailBytes: z
    .number()
    .int()
    .min(0)
    .max(256 * 1024)
    .optional()
    .default(16 * 1024),
} as const;

export function register(server: McpServer): void {
  defineTool<{
    root: string;
    name?: string;
    plainName?: string;
    updateGoldens?: boolean;
    dartDefines?: Record<string, string>;
    flavor?: string;
  }>(server, {
    name: 'start_run_unit_tests',
    description: 'MARATHON split-tool — start `flutter test test/`. Returns {jobId}.',
    inputSchema: filterShape,
    watchdog: { name: 'start_run_unit_tests', ceilingMs: 15_000, toolClass: 'quick' },
    handler: makeStartTool({ jobType: 'run_unit_tests', testRoot: 'test' }),
  });

  defineTool<{
    root: string;
    name?: string;
    plainName?: string;
    updateGoldens?: boolean;
    dartDefines?: Record<string, string>;
    flavor?: string;
  }>(server, {
    name: 'start_run_widget_tests',
    description:
      'MARATHON split-tool — start `flutter test test/widget/` (falls back to test/ if test/widget/ absent).',
    inputSchema: filterShape,
    watchdog: { name: 'start_run_widget_tests', ceilingMs: 15_000, toolClass: 'quick' },
    handler: makeStartTool({ jobType: 'run_widget_tests', testRoot: 'test/widget' }),
  });

  defineTool<{
    root: string;
    name?: string;
    plainName?: string;
    updateGoldens?: boolean;
    dartDefines?: Record<string, string>;
    flavor?: string;
  }>(server, {
    name: 'start_run_integration_tests',
    description: 'MARATHON split-tool — start `flutter test integration_test/`.',
    inputSchema: filterShape,
    watchdog: { name: 'start_run_integration_tests', ceilingMs: 15_000, toolClass: 'quick' },
    handler: makeStartTool({ jobType: 'run_integration_tests', testRoot: 'integration_test' }),
  });

  defineTool<{
    root: string;
    name?: string;
    plainName?: string;
    updateGoldens?: boolean;
    dartDefines?: Record<string, string>;
    flavor?: string;
  }>(server, {
    name: 'start_run_golden_tests',
    description:
      'Split-tool — start golden-file targeted tests. Use `name` regex to filter to golden tests.',
    inputSchema: filterShape,
    watchdog: { name: 'start_run_golden_tests', ceilingMs: 15_000, toolClass: 'quick' },
    handler: makeStartTool({ jobType: 'run_golden_tests', testRoot: 'test' }),
  });

  defineTool<{
    root: string;
    name?: string;
    plainName?: string;
    dartDefines?: Record<string, string>;
    flavor?: string;
  }>(server, {
    name: 'start_update_goldens',
    description: 'Split-tool — `flutter test --update-goldens` for matching pattern.',
    inputSchema: {
      root: rootArg,
      name: z.string().optional(),
      plainName: z.string().optional(),
      dartDefines: z.record(z.string(), z.string()).optional(),
      flavor: z.string().optional(),
    },
    watchdog: { name: 'start_update_goldens', ceilingMs: 15_000, toolClass: 'quick' },
    handler: async ({ root, name, plainName, dartDefines, flavor }) =>
      makeStartTool({ jobType: 'update_goldens', testRoot: 'test' })({
        root,
        ...(name !== undefined ? { name } : {}),
        ...(plainName !== undefined ? { plainName } : {}),
        updateGoldens: true,
        ...(dartDefines !== undefined ? { dartDefines } : {}),
        ...(flavor !== undefined ? { flavor } : {}),
      }),
  });

  // Unified poll/get/cancel — tests share the same job store and identical
  // shape so one set of tools is enough. (Sticking to start_*_tests prefixes
  // for the StartTool names keeps callsites self-documenting, but result
  // tools are uniform per plan §17.5.)

  for (const [poll, get, cancel] of [
    ['poll_run_unit_tests', 'get_run_unit_tests_result', 'cancel_run_unit_tests'],
    ['poll_run_widget_tests', 'get_run_widget_tests_result', 'cancel_run_widget_tests'],
    [
      'poll_run_integration_tests',
      'get_run_integration_tests_result',
      'cancel_run_integration_tests',
    ],
    ['poll_run_golden_tests', 'get_run_golden_tests_result', 'cancel_run_golden_tests'],
    ['poll_update_goldens', 'get_update_goldens_result', 'cancel_update_goldens'],
  ] as const) {
    defineTool<{ jobId: string; tailBytes?: number }>(server, {
      name: poll,
      description: 'Poll a test job; returns status + progress + stdoutTail.',
      inputSchema: pollShape,
      watchdog: { name: poll, ceilingMs: 10_000, toolClass: 'instant' },
      handler: async ({ jobId, tailBytes }) => {
        const rec = readJob(jobId);
        if (!rec) return err(`Unknown jobId '${jobId}'.`);
        return okJson({ ...rec, stdoutTail: readStdoutTail(jobId, tailBytes ?? 16 * 1024) });
      },
    });

    defineTool<{ jobId: string }>(server, {
      name: get,
      description: 'Get final result for a completed test job.',
      inputSchema: { jobId: z.string().min(1) },
      watchdog: { name: get, ceilingMs: 10_000, toolClass: 'instant' },
      handler: async ({ jobId }) => {
        const rec = readJob(jobId);
        if (!rec) return err(`Unknown jobId '${jobId}'.`);
        if (rec.status === 'running' || rec.status === 'pending') {
          return err(`Job '${jobId}' still ${rec.status}.`);
        }
        return okJson({ ...rec, stdout: readStdoutTail(jobId, 256 * 1024) });
      },
    });

    defineTool<{ jobId: string }>(server, {
      name: cancel,
      description: 'Cancel an in-flight test job.',
      inputSchema: { jobId: z.string().min(1) },
      watchdog: { name: cancel, ceilingMs: 10_000, toolClass: 'instant' },
      handler: async ({ jobId }) => {
        const rec = cancelJob(jobId);
        if (!rec) return err(`Unknown jobId '${jobId}'.`);
        return okJson({ status: rec.status });
      },
    });
  }

  // ─── test_filter (Quick, sync; no run) ────────────────────────────────────

  defineTool<{ root: string; namePattern?: string }>(server, {
    name: 'test_filter',
    description:
      'Discovery — list test files matching the given name regex. Walks test/ and integration_test/ for *.dart files matching the pattern; does NOT execute.',
    inputSchema: {
      root: rootArg,
      namePattern: z
        .string()
        .optional()
        .describe('Regex over relative test file path; default matches all.'),
    },
    watchdog: { name: 'test_filter', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root, namePattern }) => {
      try {
        const proj = loadProject(root);
        const re = namePattern ? new RegExp(namePattern) : /.*/;
        const out: string[] = [];
        for (const dir of ['test', 'integration_test']) {
          const full = join(proj.root, dir);
          if (!existsSync(full)) continue;
          walk(full, (p) => {
            if (!p.endsWith('_test.dart')) return;
            const rel = relative(proj.root, p);
            if (re.test(rel)) out.push(rel);
          });
        }
        return okJson({ root: proj.root, total: out.length, tests: out.sort() });
      } catch (e) {
        return errFromException(e);
      }
    },
  });
}

function walk(dir: string, visit: (path: string) => void): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, visit);
    else if (s.isFile()) visit(full);
  }
}
