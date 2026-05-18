// launch_app split-tool (MARATHON).
//
// Per plan §5.2 + §17.5: spawn `flutter run --machine`, parse machine-mode
// JSON events, expose start/poll/stop tools that the agent calls in three
// steps. The actual `flutter run` process outlives the MCP tool call.
//
// Machine-mode protocol: each stdout line is either a [JSON] envelope
// (legacy daemon protocol) or a bare JSON event in newer Flutter versions.
// Events we care about:
//   app.start        — boot starting
//   app.started      — vmServiceUri ready (this is our attach trigger)
//   app.progress     — stage messages
//   app.log          — log lines
//   app.stop         — process exiting
//   app.webLaunchUrl — web app served
//   daemon.logMessage — generic log

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile as readFileFs } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import type { Logger } from '@flutter-ultra/mcp-runtime';
import { jobFilePath, stateRead, stateUpdate } from '@flutter-ultra/state-store';

export const LaunchStageSchema = z.enum([
  'pending',
  'compiling',
  'installing',
  'booting',
  'attached',
  'failed',
  'stopped',
]);
export type LaunchStage = z.infer<typeof LaunchStageSchema>;

export const LaunchJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: z.string(),
    sessionId: z.string().optional(),
    target: z.string(),
    device: z.string(),
    flavor: z.string().optional(),
    pid: z.number().int().optional(),
    stage: LaunchStageSchema,
    vmServiceUri: z.string().optional(),
    appId: z.string().optional(),
    startedAt: z.number().int(),
    updatedAt: z.number().int(),
    exitCode: z.number().int().optional(),
    errorMessage: z.string().optional(),
    recentLog: z.array(z.string()).max(200),
  })
  .strict();
export type LaunchJob = z.infer<typeof LaunchJobSchema>;

export interface LaunchAppInput {
  projectDir: string;
  target: string;
  device: string;
  flavor?: string;
  dartDefines?: Record<string, string>;
  webRenderer?: 'canvaskit' | 'html' | 'auto';
  webPort?: number;
  webHostname?: string;
  webBrowserFlags?: string[];
  splitDebugInfo?: string;
  pubGetFirst?: boolean;
  // Auto-import from .vscode/launch.json by configuration name.
  importLaunchJsonConfig?: string;
}

export interface VscodeLaunchConfig {
  type?: string;
  request?: string;
  name?: string;
  program?: string;
  flavor?: string;
  args?: string[];
  toolArgs?: string[];
}

interface LaunchProcessHandle {
  child: ChildProcessByStdio<Writable, Readable, Readable>;
  jobId: string;
}

const PROCESSES = new Map<string, LaunchProcessHandle>();
const RECENT_LOG_MAX = 200;

export interface LaunchService {
  start(input: LaunchAppInput): Promise<LaunchJob>;
  poll(jobId: string): Promise<LaunchJob>;
  stop(jobId: string, options?: { force?: boolean }): Promise<LaunchJob>;
  // Drain all child processes on shutdown.
  shutdown(): Promise<void>;
}

export function createLaunchService(opts: {
  logger: Logger;
  onSessionReady: (
    jobId: string,
    payload: { uri: string; projectRoot: string; device: string; appName?: string; pid?: number },
  ) => Promise<string>;
}): LaunchService {
  const logger = opts.logger.child({ component: 'launchApp' });

  async function writeJob(job: LaunchJob): Promise<void> {
    await stateUpdate(jobFilePath(job.jobId), job, LaunchJobSchema, () => job);
  }

  async function readJob(jobId: string): Promise<LaunchJob> {
    const initial: LaunchJob = {
      schemaVersion: 1,
      jobId,
      target: '',
      device: '',
      stage: 'pending',
      startedAt: 0,
      updatedAt: 0,
      recentLog: [],
    };
    return stateRead(jobFilePath(jobId), initial, LaunchJobSchema);
  }

  async function patchJob(jobId: string, patch: Partial<LaunchJob>): Promise<LaunchJob> {
    const initial: LaunchJob = {
      schemaVersion: 1,
      jobId,
      target: '',
      device: '',
      stage: 'pending',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      recentLog: [],
    };
    return stateUpdate(jobFilePath(jobId), initial, LaunchJobSchema, (current) => {
      const merged: LaunchJob = {
        ...current,
        ...patch,
        updatedAt: Date.now(),
      };
      return merged;
    });
  }

  async function appendLog(jobId: string, line: string): Promise<void> {
    await stateUpdate(
      jobFilePath(jobId),
      {
        schemaVersion: 1,
        jobId,
        target: '',
        device: '',
        stage: 'pending',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        recentLog: [],
      } as LaunchJob,
      LaunchJobSchema,
      (current) => {
        const next: LaunchJob = {
          ...current,
          recentLog: [...current.recentLog, line].slice(-RECENT_LOG_MAX),
          updatedAt: Date.now(),
        };
        return next;
      },
    );
  }

  async function importVscodeConfig(
    projectDir: string,
    configName: string,
  ): Promise<VscodeLaunchConfig | null> {
    const launchJsonPath = join(projectDir, '.vscode', 'launch.json');
    try {
      const raw = await readFileFs(launchJsonPath, 'utf8');
      // .vscode/launch.json allows trailing commas + // comments — strip them.
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/,(\s*[}\]])/g, '$1');
      const parsed = JSON.parse(stripped) as { configurations?: VscodeLaunchConfig[] };
      const cfg = parsed.configurations?.find((c) => c.name === configName);
      return cfg ?? null;
    } catch (err) {
      logger.debug('importVscodeConfig failed', { err: String(err) });
      return null;
    }
  }

  function buildCliArgs(input: LaunchAppInput, vscodeCfg: VscodeLaunchConfig | null): string[] {
    const args = ['run', '--machine'];
    args.push('-t', input.target);
    args.push('-d', input.device);
    if (input.flavor) args.push('--flavor', input.flavor);
    else if (vscodeCfg?.flavor) args.push('--flavor', vscodeCfg.flavor);

    if (input.webRenderer) args.push(`--web-renderer=${input.webRenderer}`);
    if (input.webPort !== undefined) args.push(`--web-port=${input.webPort}`);
    if (input.webHostname) args.push(`--web-hostname=${input.webHostname}`);
    for (const flag of input.webBrowserFlags ?? []) args.push(`--web-browser-flag=${flag}`);
    if (input.splitDebugInfo) args.push(`--split-debug-info=${input.splitDebugInfo}`);

    const mergedDefines: Record<string, string> = {};
    // VS Code config first (lower precedence) then explicit overrides.
    if (vscodeCfg) {
      for (const a of [...(vscodeCfg.toolArgs ?? []), ...(vscodeCfg.args ?? [])]) {
        const m = a.match(/^--dart-define[s]?=([^=]+)=(.*)$/);
        if (m && m[1] !== undefined && m[2] !== undefined) {
          mergedDefines[m[1]] = m[2];
        }
      }
    }
    Object.assign(mergedDefines, input.dartDefines ?? {});
    for (const [k, v] of Object.entries(mergedDefines)) {
      args.push(`--dart-define=${k}=${v}`);
    }
    return args;
  }

  async function start(input: LaunchAppInput): Promise<LaunchJob> {
    const jobId = randomUUID();
    const projectDir = resolvePath(input.projectDir);
    const vscodeCfg = input.importLaunchJsonConfig
      ? await importVscodeConfig(projectDir, input.importLaunchJsonConfig)
      : null;
    const args = buildCliArgs(input, vscodeCfg);

    const initial: LaunchJob = {
      schemaVersion: 1,
      jobId,
      target: input.target,
      device: input.device,
      ...(input.flavor !== undefined ? { flavor: input.flavor } : {}),
      stage: 'pending',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      recentLog: [`Spawning: flutter ${args.join(' ')} (cwd=${projectDir})`],
    };
    await writeJob(initial);

    let flutterBin = process.env.FLUTTER ?? 'flutter';
    // On Windows the user usually has `flutter.bat` on PATH; spawn finds it.
    if (process.platform === 'win32' && !/\.(exe|bat|cmd)$/i.test(flutterBin)) {
      flutterBin = `${flutterBin}.bat`;
    }

    const child = spawn(flutterBin, args, {
      cwd: projectDir,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessByStdio<Writable, Readable, Readable>;

    PROCESSES.set(jobId, { child, jobId });

    child.on('error', async (err) => {
      logger.error('flutter spawn failed', { jobId, err: err.message });
      const current = await readJob(jobId);
      const stderrTail = current.recentLog
        .filter((l) => l.startsWith('[stderr]'))
        .slice(-20)
        .join('\n');
      const errorMessage = stderrTail
        ? `${err.message}\n--- last stderr ---\n${stderrTail}`
        : err.message;
      await patchJob(jobId, { stage: 'failed', errorMessage });
      PROCESSES.delete(jobId);
    });
    child.on('exit', async (code, signal) => {
      logger.info('flutter exited', { jobId, code, signal });
      PROCESSES.delete(jobId);
      const current = await readJob(jobId);
      if (current.stage === 'stopped') return;
      const isError = (code ?? 0) !== 0;
      const stderrTail = current.recentLog
        .filter((l) => l.startsWith('[stderr]'))
        .slice(-20)
        .join('\n');
      let errorMessage: string | undefined;
      if (isError) {
        const parts: string[] = [`exited with code=${code ?? 'null'}`];
        if (signal) parts[0] += ` signal=${signal}`;
        if (stderrTail) parts.push('--- last stderr ---', stderrTail);
        errorMessage = parts.join('\n');
      }
      await patchJob(jobId, {
        stage: isError ? 'failed' : 'stopped',
        ...(code !== null ? { exitCode: code } : {}),
        ...(errorMessage !== undefined ? { errorMessage } : {}),
      });
    });

    await patchJob(jobId, {
      stage: 'compiling',
      ...(child.pid !== undefined ? { pid: child.pid } : {}),
    });

    // Set up the line-buffered stdout/stderr parser.
    setupStdoutParser(
      child,
      jobId,
      projectDir,
      input.device,
      appendLog,
      patchJob,
      opts.onSessionReady,
      logger,
    );

    return readJob(jobId);
  }

  async function poll(jobId: string): Promise<LaunchJob> {
    return readJob(jobId);
  }

  async function stop(jobId: string, stopOptions: { force?: boolean } = {}): Promise<LaunchJob> {
    const handle = PROCESSES.get(jobId);
    if (handle) {
      try {
        // Machine-mode flutter accepts 'q' on stdin to stop gracefully.
        if (!stopOptions.force) {
          handle.child.stdin.write('q\n');
        }
        // Wait up to 5s for graceful, then SIGTERM, then SIGKILL.
        await new Promise<void>((resolveExit) => {
          const t1 = setTimeout(() => {
            if (handle.child.exitCode === null) handle.child.kill('SIGTERM');
          }, 2_000);
          const t2 = setTimeout(() => {
            if (handle.child.exitCode === null) handle.child.kill('SIGKILL');
            resolveExit();
          }, 5_000);
          handle.child.once('exit', () => {
            clearTimeout(t1);
            clearTimeout(t2);
            resolveExit();
          });
        });
      } catch (err) {
        logger.warn('stop threw', { jobId, err: String(err) });
      }
      PROCESSES.delete(jobId);
    }
    return patchJob(jobId, { stage: 'stopped' });
  }

  async function shutdown(): Promise<void> {
    for (const [jobId] of PROCESSES) {
      try {
        await stop(jobId, { force: true });
      } catch {
        /* swallow during shutdown */
      }
    }
  }

  return { start, poll, stop, shutdown };
}

function setupStdoutParser(
  child: ChildProcessByStdio<Writable, Readable, Readable>,
  jobId: string,
  projectDir: string,
  device: string,
  appendLog: (jobId: string, line: string) => Promise<void>,
  patchJob: (jobId: string, patch: Partial<LaunchJob>) => Promise<LaunchJob>,
  onSessionReady: (
    jobId: string,
    payload: { uri: string; projectRoot: string; device: string; appName?: string; pid?: number },
  ) => Promise<string>,
  logger: Logger,
): void {
  let stdoutBuffer = '';
  let stderrBuffer = '';

  const onStdoutLine = async (line: string): Promise<void> => {
    if (!line) return;
    await appendLog(jobId, line);

    // Machine-mode lines wrap a single JSON object in `[ ... ]` brackets.
    const jsonText = extractMachineJson(line);
    if (!jsonText) return;
    try {
      const parsed = JSON.parse(jsonText) as { event?: string; params?: Record<string, unknown> };
      if (parsed?.event === 'app.started' && parsed.params) {
        const uri = pickString(parsed.params, ['vmServiceUri', 'wsUri', 'observatoryUri']);
        if (uri) {
          await patchJob(jobId, { stage: 'attached', vmServiceUri: uri });
          try {
            const sessionId = await onSessionReady(jobId, {
              uri,
              projectRoot: projectDir,
              device,
              ...(pickString(parsed.params, ['appId'])
                ? { appName: pickString(parsed.params, ['appId'])! }
                : {}),
              ...(child.pid !== undefined ? { pid: child.pid } : {}),
            });
            await patchJob(jobId, { sessionId });
          } catch (err) {
            logger.error('onSessionReady failed', { jobId, err: String(err) });
          }
        }
      } else if (parsed?.event === 'app.start' && parsed.params) {
        await patchJob(jobId, { stage: 'booting' });
      } else if (parsed?.event === 'app.progress' && parsed.params) {
        const msg = pickString(parsed.params, ['message']);
        if (msg && /install/i.test(msg)) await patchJob(jobId, { stage: 'installing' });
        else if (msg && /compil/i.test(msg)) await patchJob(jobId, { stage: 'compiling' });
      } else if (parsed?.event === 'app.stop') {
        await patchJob(jobId, { stage: 'stopped' });
      }
    } catch (err) {
      logger.debug('machine-mode JSON parse failed', { line, err: String(err) });
    }
  };

  const onStderrLine = async (line: string): Promise<void> => {
    if (!line) return;
    await appendLog(jobId, `[stderr] ${line}`);
  };

  child.stdout.on('data', async (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) await onStdoutLine(line.trimEnd());
  });
  child.stderr.on('data', async (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8');
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() ?? '';
    for (const line of lines) await onStderrLine(line.trimEnd());
  });
}

function extractMachineJson(line: string): string | null {
  // Machine-mode: `[{...}]`
  const trimmed = line.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    if (inner.startsWith('{') && inner.endsWith('}')) return inner;
  }
  // Some events arrive bare (newer Flutter).
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
