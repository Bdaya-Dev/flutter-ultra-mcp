// start_patrol_develop — MARATHON tool. Starts an interactive patrol
// develop session that stays warm between test runs. Only one session per
// server process; second call returns the existing one with reused=true.

import { spawn } from 'node:child_process';
import { z } from 'zod';
import { defineTool } from './types.js';
import { findFlutterProject } from '../runtime/project.js';
import { buildPatrolInvocation } from '../runtime/patrol-cli.js';

export const startPatrolDevelopTool = defineTool({
  name: 'start_patrol_develop',
  description:
    'Start a warm `patrol develop` session for repeated fast test runs. Returns taskId immediately. Only one develop session per server process; second call returns the existing taskId with reused=true.',
  inputSchema: z.object({
    projectRoot: z.string().min(1),
    target: z.string().min(1).describe('Test file to load (required by patrol develop).'),
    device: z.string().optional(),
    flavor: z.string().optional(),
    buildMode: z.enum(['debug', 'profile', 'release']).optional(),
    dartDefines: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    dartDefineFromFile: z.array(z.string()).optional(),
    openDevtools: z.boolean().optional(),
    useRawCli: z.boolean().optional(),
    extraArgs: z.array(z.string()).optional(),
  }),
  async handler(input, ctx) {
    const existing = ctx.develop.get();
    if (existing) {
      return {
        taskId: existing.id,
        reused: true,
        pid: existing.child?.pid ?? null,
        startedAt: existing.startedAt,
      };
    }
    const project = findFlutterProject(input.projectRoot);
    const patrolArgs = buildDevelopArgs(input);
    const invocation = buildPatrolInvocation({
      project,
      patrolArgs,
      ...(input.useRawCli !== undefined ? { useRawCli: input.useRawCli } : {}),
    });

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (ctx.env.webBrowserArgs) {
      env.PATROL_WEB_BROWSER_ARGS = ctx.env.webBrowserArgs;
    }

    const record = ctx.jobs.create({
      kind: 'develop',
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
      // develop accepts stdin commands (r=hot-reload, R=hot-restart, q=quit).
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    ctx.jobs.attachChild(record.id, child);
    ctx.develop.register(record);

    return {
      taskId: record.id,
      reused: false,
      command: invocation.command,
      args: invocation.args,
      wrapperScript: record.wrapperScript,
      pid: child.pid ?? null,
      startedAt: record.startedAt,
    };
  },
});

export function buildDevelopArgs(
  input: z.infer<typeof startPatrolDevelopTool.inputSchema>,
): string[] {
  const args: string[] = ['develop', '--target', input.target];
  if (input.device) args.push('--device', input.device);
  if (input.flavor) args.push('--flavor', input.flavor);
  if (input.buildMode) args.push(`--${input.buildMode}`);
  if (input.openDevtools) args.push('--open-devtools');
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
  if (input.extraArgs) args.push(...input.extraArgs);
  return args;
}
