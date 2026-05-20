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
import { freePort } from './portCleanup.js';
import { enumerateProcesses, findChromeCdpPort } from './discovery.js';

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

export const WebLaunchModeSchema = z.enum(['chrome', 'chrome-headed', 'web-server']);

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
    chromeCdpPort: z.number().int().optional(),
    webLaunchMode: WebLaunchModeSchema.optional(),
    webServerUrl: z.string().optional(),
    startedAt: z.number().int(),
    updatedAt: z.number().int(),
    exitCode: z.number().int().optional(),
    errorMessage: z.string().optional(),
    recentLog: z.array(z.string()).max(200),
  })
  .strict();
export type LaunchJob = z.infer<typeof LaunchJobSchema>;

export type WebLaunchMode = 'chrome' | 'chrome-headed' | 'web-server';

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
  importLaunchJsonConfig?: string;
  headless?: boolean;
  webLaunchMode?: WebLaunchMode;
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

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

interface LaunchProcessHandle {
  child: ChildProcessByStdio<Writable, Readable, Readable>;
  jobId: string;
  appId?: string;
  pendingRequests: Map<number, PendingRequest>;
  nextRequestId: number;
}

const PROCESSES = new Map<string, LaunchProcessHandle>();
const RECENT_LOG_MAX = 200;

export interface LaunchService {
  start(input: LaunchAppInput): Promise<LaunchJob>;
  poll(jobId: string): Promise<LaunchJob>;
  stop(jobId: string, options?: { force?: boolean }): Promise<LaunchJob>;
  callServiceExtension(
    jobId: string,
    methodName: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
  restart(jobId: string, options?: { fullRestart?: boolean }): Promise<unknown>;
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
    const mode = input.webLaunchMode ?? 'chrome';
    const effectiveDevice = mode === 'web-server' ? 'web-server' : input.device;

    const args = ['run', '--machine'];
    args.push('-t', input.target);
    args.push('-d', effectiveDevice);
    if (input.flavor) args.push('--flavor', input.flavor);
    else if (vscodeCfg?.flavor) args.push('--flavor', vscodeCfg.flavor);

    const isWebDevice = /^(chrome|edge|web-server)$/i.test(effectiveDevice);
    const isWebServer = mode === 'web-server';
    process.stderr.write(
      `[flutter-ultra-runtime] buildCliArgs: device=${effectiveDevice} mode=${mode} isWebDevice=${isWebDevice} headless=${input.headless}\n`,
    );
    if (input.webRenderer) args.push(`--web-renderer=${input.webRenderer}`);
    if (input.webPort !== undefined) args.push(`--web-port=${input.webPort}`);
    if (input.webHostname) args.push(`--web-hostname=${input.webHostname}`);
    const userFlags = input.webBrowserFlags ?? [];
    if (!isWebServer) {
      const hasHeadlessFlag = userFlags.some((f) => /headless/i.test(f));
      const wantHeadless = mode === 'chrome' && input.headless !== false;
      if (isWebDevice && wantHeadless && !hasHeadlessFlag) {
        args.push('--web-browser-flag=--headless=new');
      }
    }
    for (const flag of userFlags) args.push(`--web-browser-flag=${flag}`);
    if (input.splitDebugInfo) args.push(`--split-debug-info=${input.splitDebugInfo}`);

    const mergedDefines: Record<string, string> = {};
    // VS Code config first (lower precedence) then explicit overrides.
    if (vscodeCfg) {
      const allArgs = [...(vscodeCfg.toolArgs ?? []), ...(vscodeCfg.args ?? [])];
      parseDartDefinesFromArgs(allArgs, mergedDefines);
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

    // CDP port discovery for web targets.
    //
    // IMPORTANT: Do NOT pre-allocate a port and inject --remote-debugging-port
    // via --web-browser-flag. Flutter's ChromiumLauncher sets its OWN
    // --remote-debugging-port flag internally and reads the actual port from
    // Chrome's DevToolsActivePort file. Injecting a second flag causes Chrome
    // to bind our port but Flutter to poll its own → ECONNREFUSED.
    //
    // Instead: let Flutter manage the port, then discover it from Chrome's
    // process command line via findChromeCdpPort() after launch.
    const effectiveMode = input.webLaunchMode ?? 'chrome';
    const isWebDevice = /^(chrome|edge|web-server)$/i.test(
      effectiveMode === 'web-server' ? 'web-server' : input.device,
    );
    let chromeCdpPort: number | undefined;
    // Only pre-set CDP port if the USER explicitly passed --remote-debugging-port.
    if (isWebDevice && effectiveMode !== 'web-server') {
      const userDebugPort = args.find((a) => /remote-debugging-port=(\d+)/i.test(a));
      if (userDebugPort) {
        const m = userDebugPort.match(/remote-debugging-port=(\d+)/i);
        if (m?.[1]) chromeCdpPort = Number(m[1]);
      }
      // Otherwise: discovered post-launch via findChromeCdpPort() in discovery.ts
    }

    const initial: LaunchJob = {
      schemaVersion: 1,
      jobId,
      target: input.target,
      device: effectiveMode === 'web-server' ? 'web-server' : input.device,
      ...(input.flavor !== undefined ? { flavor: input.flavor } : {}),
      ...(chromeCdpPort !== undefined ? { chromeCdpPort } : {}),
      ...(effectiveMode !== 'chrome' ? { webLaunchMode: effectiveMode } : {}),
      stage: 'pending',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      recentLog: [`Spawning: flutter ${args.join(' ')} (cwd=${projectDir})`],
    };
    await writeJob(initial);

    // Pre-launch: free the web port if an orphan process holds it (#74).
    if (isWebDevice && input.webPort !== undefined) {
      const freed = await freePort(input.webPort, (msg) => logger.info(msg));
      if (freed.length > 0) {
        await appendLog(
          jobId,
          `[port-cleanup] killed ${freed.length} orphan(s) on port ${input.webPort}: PIDs ${freed.join(', ')}`,
        );
      }
    }

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
      shell: process.platform === 'win32',
    }) as ChildProcessByStdio<Writable, Readable, Readable>;

    PROCESSES.set(jobId, { child, jobId, pendingRequests: new Map(), nextRequestId: 1 });

    child.on('error', (err) => {
      void (async () => {
        try {
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
        } catch (inner) {
          logger.error('error handler threw', { jobId, inner: String(inner) });
          PROCESSES.delete(jobId);
        }
      })();
    });
    child.on('exit', (code, signal) => {
      void (async () => {
        try {
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
        } catch (inner) {
          logger.error('exit handler threw', { jobId, inner: String(inner) });
        }
      })();
    });

    await patchJob(jobId, {
      stage: 'compiling',
      ...(child.pid !== undefined ? { pid: child.pid } : {}),
    });

    const handle = PROCESSES.get(jobId)!;
    setupStdoutParser(
      child,
      handle,
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
        if (stopOptions.force) {
          // Force: immediate SIGKILL, no grace period.
          handle.child.kill('SIGKILL');
        } else {
          // Machine-mode flutter accepts 'q' on stdin to stop gracefully.
          handle.child.stdin.write('q\n');
        }
        // Wait for exit (with escalation timeouts for graceful path).
        await new Promise<void>((resolveExit) => {
          const t1 = stopOptions.force
            ? undefined
            : setTimeout(() => {
                if (handle.child.exitCode === null) handle.child.kill('SIGTERM');
              }, 2_000);
          const t2 = setTimeout(
            () => {
              if (handle.child.exitCode === null) handle.child.kill('SIGKILL');
              resolveExit();
            },
            stopOptions.force ? 2_000 : 5_000,
          );
          handle.child.once('exit', () => {
            if (t1) clearTimeout(t1);
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

  function sendDaemonCommand(
    handle: LaunchProcessHandle,
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = handle.nextRequestId++;
      const timer = setTimeout(() => {
        handle.pendingRequests.delete(id);
        reject(new Error(`daemon command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      handle.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          handle.pendingRequests.delete(id);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          handle.pendingRequests.delete(id);
          reject(err);
        },
      });
      const msg = JSON.stringify([{ id, method, params }]);
      handle.child.stdin.write(msg + '\n');
    });
  }

  async function callServiceExtension(
    jobId: string,
    methodName: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const handle = PROCESSES.get(jobId);
    if (!handle) throw new Error(`no running process for job ${jobId}`);
    if (!handle.appId) throw new Error(`appId not yet available for job ${jobId}`);
    return sendDaemonCommand(handle, 'app.callServiceExtension', {
      appId: handle.appId,
      methodName,
      ...(params !== undefined ? { params } : {}),
    });
  }

  async function restart(
    jobId: string,
    restartOptions: { fullRestart?: boolean } = {},
  ): Promise<unknown> {
    const handle = PROCESSES.get(jobId);
    if (!handle) throw new Error(`no running process for job ${jobId}`);
    if (!handle.appId) throw new Error(`appId not yet available for job ${jobId}`);
    return sendDaemonCommand(
      handle,
      'app.restart',
      {
        appId: handle.appId,
        fullRestart: restartOptions.fullRestart ?? false,
        pause: false,
      },
      90_000,
    );
  }

  return { start, poll, stop, callServiceExtension, restart, shutdown };
}

function setupStdoutParser(
  child: ChildProcessByStdio<Writable, Readable, Readable>,
  handle: LaunchProcessHandle,
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
  const jobId = handle.jobId;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let isWebTarget = false;
  let attached = false;

  async function completeAttach(uri?: string): Promise<void> {
    process.stderr.write(
      `[flutter-ultra-runtime] completeAttach called: attached=${attached} isWebTarget=${isWebTarget} uri=${uri ?? 'none'}\n`,
    );
    if (attached) return;
    attached = true;

    // Discover Chrome's actual CDP port from its process command line.
    // Flutter's ChromiumLauncher allocates its own --remote-debugging-port;
    // we must NOT inject our own (causes port mismatch → ECONNREFUSED).
    let discoveredCdpPort: number | undefined;
    if (isWebTarget) {
      try {
        const procs = await enumerateProcesses(logger);
        discoveredCdpPort = findChromeCdpPort(procs);
        if (discoveredCdpPort) {
          process.stderr.write(
            `[flutter-ultra-runtime] discovered Chrome CDP port ${discoveredCdpPort}\n`,
          );
        }
      } catch (err) {
        logger.debug('CDP port discovery failed', { err: String(err) });
      }
    }

    await patchJob(jobId, {
      stage: 'attached',
      ...(uri ? { vmServiceUri: uri } : {}),
      ...(discoveredCdpPort ? { chromeCdpPort: discoveredCdpPort } : {}),
    });
    process.stderr.write(`[flutter-ultra-runtime] patchJob(attached) done for ${jobId}\n`);
    if (isWebTarget) {
      logger.info('web target attached via stdin proxy', { jobId, uri, cdpPort: discoveredCdpPort });
      return;
    }
    if (!uri) return;
    try {
      const sessionId = await onSessionReady(jobId, {
        uri,
        projectRoot: projectDir,
        device,
        ...(handle.appId ? { appName: handle.appId } : {}),
        ...(child.pid !== undefined ? { pid: child.pid } : {}),
      });
      await patchJob(jobId, { sessionId });
    } catch (err) {
      logger.error('onSessionReady failed', { jobId, err: String(err) });
    }
  }

  const onStdoutLine = async (line: string): Promise<void> => {
    if (!line) return;
    await appendLog(jobId, line);

    const jsonText = extractMachineJson(line);
    if (!jsonText) return;
    try {
      const parsed = JSON.parse(jsonText) as {
        id?: number;
        event?: string;
        result?: unknown;
        error?: { code?: number; message?: string; data?: unknown };
        params?: Record<string, unknown>;
      };

      // Route daemon command responses to pending requests.
      if (parsed.id !== undefined && !parsed.event) {
        const pending = handle.pendingRequests.get(parsed.id);
        if (pending) {
          if (parsed.error) {
            pending.reject(new Error(parsed.error.message ?? 'daemon command failed'));
          } else {
            pending.resolve(parsed.result);
          }
        }
        return;
      }

      if (parsed?.event === 'app.started' && parsed.params) {
        const uri = pickString(parsed.params, ['vmServiceUri', 'wsUri', 'observatoryUri']);
        const parsedAppId = pickString(parsed.params, ['appId']);
        if (parsedAppId) handle.appId ??= parsedAppId;
        process.stderr.write(
          `[flutter-ultra-runtime] app.started: uri=${uri ?? 'none'} isWebTarget=${isWebTarget} appId=${handle.appId}\n`,
        );
        if (uri) {
          await completeAttach(uri);
        } else if (isWebTarget) {
          await completeAttach();
        }
      } else if (parsed?.event === 'app.webLaunchUrl' && parsed.params) {
        isWebTarget = true;
        const webUrl = pickString(parsed.params, ['url']);
        process.stderr.write(`[flutter-ultra-runtime] app.webLaunchUrl → isWebTarget=true url=${webUrl}\n`);
        logger.info('web launch URL', { jobId, url: webUrl });
        if (webUrl) {
          await patchJob(jobId, { webServerUrl: webUrl });
        }
        // web-server mode: no DWDS attach will happen, transition immediately.
        const currentJob = await stateRead(jobFilePath(jobId), {
          schemaVersion: 1, jobId, target: '', device: '', stage: 'pending',
          startedAt: 0, updatedAt: 0, recentLog: [],
        } as LaunchJob, LaunchJobSchema);
        if (currentJob.webLaunchMode === 'web-server') {
          await completeAttach();
        }
      } else if (parsed?.event === 'app.start' && parsed.params) {
        const startAppId = pickString(parsed.params, ['appId']);
        if (startAppId) handle.appId = startAppId;
        await patchJob(jobId, { stage: 'booting' });
      } else if (parsed?.event === 'app.debugPort' && parsed.params) {
        const uri = pickString(parsed.params, ['wsUri', 'baseUri']);
        if (uri) {
          await patchJob(jobId, { vmServiceUri: uri });
          if (!isWebTarget) await completeAttach(uri);
        }
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

/**
 * Parse --dart-define / --dart-defines from an args array into a record.
 * Handles both forms:
 *   Single-element: ["--dart-define=key=value"]
 *   Two-element:    ["--dart-define", "key=value"]
 */
export function parseDartDefinesFromArgs(
  args: string[],
  out: Record<string, string> = {},
): Record<string, string> {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    // Single-element: --dart-define=key=value or --dart-defines=key=value
    const combined = a.match(/^--dart-defines?=([^=]+)=(.*)$/);
    if (combined && combined[1] !== undefined && combined[2] !== undefined) {
      out[combined[1]] = combined[2];
      continue;
    }
    // Two-element: --dart-define key=value or --dart-defines key=value
    if (/^--dart-defines?$/.test(a) && i + 1 < args.length) {
      const next = args[i + 1]!;
      const kv = next.match(/^([^=]+)=(.*)$/);
      if (kv && kv[1] !== undefined && kv[2] !== undefined) {
        out[kv[1]] = kv[2];
        i++; // skip the consumed value element
      }
    }
  }
  return out;
}
