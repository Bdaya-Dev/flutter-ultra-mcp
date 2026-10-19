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
import { getProcessStartKey, killProcessTreeVerified } from './processTree.js';

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
  // hac#545: the OS "start identity" of `child.pid`, captured right after
  // spawn. On Windows `child.pid` is cmd.exe's PID (we spawn with
  // `shell: true`), not the real Flutter tool's — this is what lets a later
  // dedup/supersede verify it's still the SAME cmd.exe before killing its
  // (by-then-formed) descendant tree, instead of trusting a raw PID that
  // may have been reused. See processTree.ts.
  pidStartKey?: string;
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

export interface LiveSessionHandle {
  id: string;
  // `| undefined` (not just `?:`) so a Session straight from the registry
  // (whose zod-inferred `pid` is `number | undefined`) assigns cleanly under
  // exactOptionalPropertyTypes.
  pid?: number | undefined;
  // hac#545: see processTree.ts — verified before a dedup kill touches `pid`.
  pidStartKey?: string | undefined;
}

export function createLaunchService(opts: {
  logger: Logger;
  onSessionReady: (
    jobId: string,
    payload: {
      uri: string;
      projectRoot: string;
      device: string;
      appName?: string;
      pid?: number;
      pidStartKey?: string;
    },
  ) => Promise<string>;
  /**
   * hac#545 / flutter-ultra-mcp#545: looked up BEFORE spawning so a lane that
   * calls `launch_app` twice for the same project+device never ends up with
   * two live `flutter run` trees. Backed by the MCP's own session registry
   * (sessions.json), never by command-line text matching.
   */
  findLiveSessionForTarget?: (
    projectDir: string,
    device: string,
  ) => Promise<LiveSessionHandle | undefined>;
  /** Kills the previous session's process + detaches it from the registry. */
  stopLiveSession?: (session: LiveSessionHandle) => Promise<void>;
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

    // hac#545: a lane must never hold two `flutter run` trees for one
    // project+device. Stop whatever the registry says is still live for
    // this (projectDir, device) pair BEFORE spawning — never after, so
    // there is no window where both processes run at once.
    if (opts.findLiveSessionForTarget) {
      const existing = await opts.findLiveSessionForTarget(projectDir, input.device);
      if (existing) {
        logger.info('launch_app: superseding previous live session for same project+device', {
          projectDir,
          device: input.device,
          previousSessionId: existing.id,
          previousPid: existing.pid,
        });
        if (opts.stopLiveSession) {
          try {
            await opts.stopLiveSession(existing);
          } catch (err) {
            logger.warn('stopLiveSession threw; proceeding with new launch anyway', {
              previousSessionId: existing.id,
              err: String(err),
            });
          }
        }
      }
    }

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

    // hac#545: capture the spawned PID's start identity NOW, while it's
    // definitely still ours — not later (by the time `app.started` fires,
    // the PID could theoretically have been reused if the process died and
    // raced an unrelated process for the same PID in between). Best-effort
    // and NON-blocking: enumerating the process table costs real wall time
    // (measured ~0.5-1s via PowerShell CIM on Windows) and `start()` must
    // return fast regardless. A miss here only means a later dedup kill on
    // this session can't cross-verify the PID before killing its tree —
    // `killProcessTreeVerified` still walks and kills the tree without it,
    // just without the reuse guard (see processTree.ts).
    if (child.pid !== undefined) {
      const pid = child.pid;
      void getProcessStartKey(pid)
        .then((startKey) => {
          const handleNow = PROCESSES.get(jobId);
          if (handleNow && startKey !== undefined) handleNow.pidStartKey = startKey;
        })
        .catch((err: unknown) => {
          logger.debug('getProcessStartKey failed', { jobId, err: String(err) });
        });
    }

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

  // hac#545: the FINAL kill, wherever stop() lands on one, must free the
  // whole tree the launch spawned, not just `handle.child` (on Windows
  // that's cmd.exe — see processTree.ts) — `handle.child.kill('SIGKILL')`
  // alone leaves Flutter's real tool / frontend_server / Dart VM running.
  async function killHandleTree(handle: LaunchProcessHandle): Promise<void> {
    if (handle.child.pid === undefined) {
      handle.child.kill('SIGKILL');
      return;
    }
    await killProcessTreeVerified(handle.child.pid, handle.pidStartKey);
  }

  async function stop(jobId: string, stopOptions: { force?: boolean } = {}): Promise<LaunchJob> {
    const handle = PROCESSES.get(jobId);
    if (handle) {
      try {
        await new Promise<void>((resolveExit) => {
          let settled = false;
          const t1 = stopOptions.force
            ? undefined
            : setTimeout(() => {
                if (handle.child.exitCode === null) handle.child.kill('SIGTERM');
              }, 2_000);
          const t2 = setTimeout(
            () => {
              if (handle.child.exitCode === null) {
                void killHandleTree(handle)
                  .catch((err: unknown) => {
                    logger.warn('escalated killHandleTree failed', { jobId, err: String(err) });
                  })
                  .finally(finish);
              } else {
                finish();
              }
            },
            stopOptions.force ? 2_000 : 5_000,
          );
          const finish = (): void => {
            if (settled) return;
            settled = true;
            if (t1) clearTimeout(t1);
            clearTimeout(t2);
            resolveExit();
          };
          // Attach the exit listener BEFORE triggering any kill below.
          // `killHandleTree`'s real OS `process.kill` on the ACTUAL PID
          // makes Node's ChildProcess wrapper emit 'exit' near-instantly —
          // if that emit happened before a listener existed, this would
          // wait out the full escalation timeout for nothing.
          handle.child.once('exit', finish);

          if (stopOptions.force) {
            // Force: immediate verified-tree kill, no grace period.
            void killHandleTree(handle).catch((err: unknown) => {
              logger.warn('force killHandleTree failed', { jobId, err: String(err) });
            });
          } else {
            // Machine-mode flutter accepts 'q' on stdin to stop gracefully.
            handle.child.stdin.write('q\n');
          }
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
    payload: {
      uri: string;
      projectRoot: string;
      device: string;
      appName?: string;
      pid?: number;
      pidStartKey?: string;
    },
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
      logger.info('web target attached via stdin proxy', {
        jobId,
        uri,
        cdpPort: discoveredCdpPort,
      });
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
        ...(handle.pidStartKey !== undefined ? { pidStartKey: handle.pidStartKey } : {}),
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
            const parts = [`daemon command failed`];
            if (parsed.error.message) parts.push(parsed.error.message);
            if (parsed.error.code !== undefined) parts.push(`(code ${parsed.error.code})`);
            if (parsed.error.data) {
              const dataStr =
                typeof parsed.error.data === 'string'
                  ? parsed.error.data
                  : JSON.stringify(parsed.error.data);
              parts.push(`\n${dataStr}`);
            }
            pending.reject(new Error(parts.join(': ')));
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
        process.stderr.write(
          `[flutter-ultra-runtime] app.webLaunchUrl → isWebTarget=true url=${webUrl}\n`,
        );
        logger.info('web launch URL', { jobId, url: webUrl });
        if (webUrl) {
          await patchJob(jobId, { webServerUrl: webUrl });
        }
        // web-server mode: no DWDS attach will happen, transition immediately.
        const currentJob = await stateRead(
          jobFilePath(jobId),
          {
            schemaVersion: 1,
            jobId,
            target: '',
            device: '',
            stage: 'pending',
            startedAt: 0,
            updatedAt: 0,
            recentLog: [],
          } as LaunchJob,
          LaunchJobSchema,
        );
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
          // Attach for ALL targets — web included. Previously only non-web
          // targets attached here, waiting for app.started for web. But on
          // Windows, app.started may never fire if DWDS handshake stalls,
          // leaving poll stuck at "booting" despite a valid debug URI.
          await completeAttach(uri);
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
