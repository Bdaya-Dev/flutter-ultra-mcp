// start_patrol_test — MARATHON split-tool. Spawns `patrol test ...`,
// returns a taskId immediately. Caller polls poll_patrol_job and finalizes
// via get_patrol_result.

import { spawn } from 'node:child_process';
import { z } from 'zod';
import { defineTool } from './types.js';
import { findFlutterProject } from '../runtime/project.js';
import { buildPatrolInvocation } from '../runtime/patrol-cli.js';

const dartDefineSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .describe('Custom --dart-define key=value pairs.');

const SAFE_BROWSER_DEFAULTS = [
  '--enable-unsafe-swiftshader',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];

export const startPatrolTestTool = defineTool({
  name: 'start_patrol_test',
  description:
    'Start a `patrol test` run as a background job and return a taskId immediately. Wraps patrol_cli with PowerShell-safe browser args, optional dart-defines, target/name filters, and per-platform device selection. Poll via poll_patrol_job, finalize via get_patrol_result.',
  inputSchema: z.object({
    projectRoot: z.string().min(1).describe('Absolute Flutter project root.'),
    target: z
      .string()
      .optional()
      .describe('Test file path (relative to projectRoot). Omit to run all.'),
    name: z.string().optional().describe('Regex matched against test names (forwarded as --name).'),
    device: z
      .string()
      .optional()
      .describe('Device id or name (e.g. chrome, windows, <emulator-id>).'),
    flavor: z.string().optional(),
    dartDefines: dartDefineSchema.optional(),
    dartDefineFromFile: z
      .array(z.string())
      .optional()
      .describe('Extra --dart-define-from-file paths.'),
    buildMode: z
      .enum(['debug', 'profile', 'release'])
      .optional()
      .describe('Underlying flutter build mode (default debug).'),
    tags: z.string().optional(),
    excludeTags: z.string().optional(),
    coverage: z.boolean().optional(),
    showFlutterLogs: z.boolean().optional(),
    /** Web-specific options. */
    web: z
      .object({
        port: z.number().int().positive().optional(),
        headless: z.enum(['true', 'false', 'new']).optional(),
        initTimeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Per-page initialisation timeout. Defaults to 180000ms (vs upstream 60000).'),
        serverTimeoutMs: z.number().int().positive().optional(),
        browserArgs: z
          .array(z.string())
          .optional()
          .describe('Extra Chromium flags. Merged with PATROL_WEB_BROWSER_ARGS safe defaults.'),
      })
      .optional(),
    /** Skip wrapper-script detection (./scripts/run_patrol_web.ps1). */
    useRawCli: z
      .boolean()
      .optional()
      .describe(
        'Skip wrapper-script detection. Defaults false so projects with ./scripts/run_patrol_web.* are honored.',
      ),
    /** Extra raw flags appended after our generated args. Escape hatch. */
    extraArgs: z
      .array(z.string())
      .optional()
      .describe('Raw patrol_cli args appended after generated ones.'),
  }),
  async handler(input, ctx) {
    const project = findFlutterProject(input.projectRoot);
    const patrolArgs = buildPatrolTestArgs(input, ctx.env.webBrowserArgs);
    const invocation = buildPatrolInvocation({
      project,
      patrolArgs,
      ...(input.useRawCli !== undefined ? { useRawCli: input.useRawCli } : {}),
    });

    const mergedBrowserArgsList = input.web
      ? mergeBrowserArgs(ctx.env.webBrowserArgs, input.web.browserArgs ?? [])
      : [];
    const env = mergedChildEnv(ctx.env.webBrowserArgs, mergedBrowserArgsList);
    const record = ctx.jobs.create({
      kind: 'test',
      command: invocation.command,
      args: invocation.args,
      cwd: project.root,
      wrapperScript: invocation.kind === 'wrapper-script' ? invocation.scriptPath : null,
      envSnapshot: {
        PATROL_WEB_BROWSER_ARGS: env.PATROL_WEB_BROWSER_ARGS ?? '',
      },
    });

    const child = spawn(invocation.command, invocation.args, {
      cwd: project.root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    ctx.jobs.attachChild(record.id, child);

    return {
      taskId: record.id,
      command: invocation.command,
      args: invocation.args,
      wrapperScript: record.wrapperScript,
      pid: child.pid ?? null,
      startedAt: record.startedAt,
    };
  },
});

export function buildPatrolTestArgs(
  input: z.infer<typeof startPatrolTestTool.inputSchema>,
  envBrowserArgs: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const args: string[] = ['test'];
  if (input.target) args.push('--target', input.target);
  if (input.name) args.push('--name', input.name);
  if (input.device) args.push('--device', input.device);
  if (input.flavor) args.push('--flavor', input.flavor);
  if (input.buildMode) args.push(`--${input.buildMode}`);
  if (input.tags) args.push('--tags', input.tags);
  if (input.excludeTags) args.push('--exclude-tags', input.excludeTags);
  if (input.coverage) args.push('--coverage');
  if (input.showFlutterLogs) args.push('--show-flutter-logs');
  if (input.dartDefines) {
    for (const [k, v] of Object.entries(input.dartDefines)) {
      args.push('--dart-define', `${k}=${String(v)}`);
    }
  }
  if (input.dartDefineFromFile) {
    for (const f of input.dartDefineFromFile) {
      args.push('--dart-define-from-file', f);
    }
  }

  if (input.web) {
    const w = input.web;
    if (w.port !== undefined) args.push('--web-port', String(w.port));
    if (w.headless !== undefined) args.push('--web-headless', w.headless);
    args.push('--web-init-timeout', String(w.initTimeoutMs ?? 180_000));
    if (w.serverTimeoutMs !== undefined) {
      args.push('--web-server-timeout', String(w.serverTimeoutMs));
    }
    const browserArgs = mergeBrowserArgs(envBrowserArgs, w.browserArgs ?? []);
    if (browserArgs.length > 0 && platform !== 'win32') {
      args.push('--web-browser-args', browserArgs.join(','));
    }
  }

  if (input.extraArgs) args.push(...input.extraArgs);
  return args;
}

function mergedChildEnv(
  envBrowserArgs: string,
  mergedBrowserArgsList?: string[],
): NodeJS.ProcessEnv {
  // Preserve every parent env var; explicitly set PATROL_WEB_BROWSER_ARGS
  // if .mcp.json provided one, so wrapper scripts and project hooks read
  // the same value the user configured globally.
  const env: NodeJS.ProcessEnv = { ...process.env };
  // cli_completion reads HOME; on Windows only USERPROFILE is set by default.
  if (process.platform === 'win32' && !env.HOME && env.USERPROFILE) {
    env.HOME = env.USERPROFILE;
  }
  if (mergedBrowserArgsList && mergedBrowserArgsList.length > 0) {
    env.PATROL_WEB_BROWSER_ARGS = mergedBrowserArgsList.join(',');
  } else if (envBrowserArgs) {
    env.PATROL_WEB_BROWSER_ARGS = envBrowserArgs;
  }
  return env;
}

export function mergeBrowserArgs(envBrowserArgs: string, extra: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const push = (flag: string): void => {
    const trimmed = flag.trim();
    if (!trimmed) return;
    const key = trimmed.split('=')[0] ?? trimmed;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  };

  // Always inject the safe defaults — mandatory for headless CanvasKit.
  for (const flag of SAFE_BROWSER_DEFAULTS) push(flag);
  if (envBrowserArgs) {
    for (const flag of envBrowserArgs.split(',')) push(flag);
  }
  for (const flag of extra) push(flag);
  return result;
}
