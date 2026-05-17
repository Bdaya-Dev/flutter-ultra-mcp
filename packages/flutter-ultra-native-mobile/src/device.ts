// Device abstraction — every tool routes shell commands and file uploads
// through this interface so a future SSH/WSL/cloud-device adapter can
// drop in without touching tool code.
//
// Today: LocalDevice (child_process.spawn). Tomorrow: SshDevice, WslDevice.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export type DeviceKind = 'android' | 'ios-sim' | 'ios-real';

export interface ShellResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

export interface ShellOptions {
  // Wall-clock kill ceiling. Caller's responsibility to set sane values per
  // command. Watchdog wrapper will also abort via signal.
  timeoutMs?: number;
  // Inputs piped to stdin then EOF.
  input?: string | Buffer;
  // Forwarded AbortSignal — kills the spawned process when fired.
  signal?: AbortSignal;
  // Override cwd for the spawned process. Local-only; remote adapters ignore.
  cwd?: string;
  // Treat stdout as binary (don't decode utf8). Returned as base64 string.
  binaryStdout?: boolean;
  // Additional env vars merged with process.env.
  env?: Record<string, string>;
}

export interface UploadOptions {
  // For Android: adb push <local> <remote>.
  // For iOS sim: simctl io <device> install — not used for arbitrary files.
  // Returns the remote path actually used so callers can chain commands.
  remotePath: string;
  mode?: number;
}

// The device transport. Tools speak this dialect only.
export interface DeviceTransport {
  readonly id: string;
  readonly kind: DeviceKind;
  // Free-form metadata about the device. Surfaced by list_devices.
  meta(): Promise<Record<string, string>>;
  // Run a single command. argv[0] is the binary; rest are args.
  // The transport is responsible for marshalling onto the actual device.
  shell(argv: readonly string[], options?: ShellOptions): Promise<ShellResult>;
  // Push a local file to the device. Returns the remote path used.
  upload(localPath: string, options: UploadOptions): Promise<string>;
  // Pull a remote file off the device into a local path. Returns the local path.
  download(remotePath: string, localPath?: string): Promise<string>;
  // Best-effort liveness check. False is a hint the device disappeared.
  isAlive(): Promise<boolean>;
  // Drop any cached connections. Called by registry on remove().
  dispose(): Promise<void>;
}

// LocalDevice — shells out via child_process. This is the foundation that
// every Android/iOS adapter wraps. A future SshDevice would implement the
// same interface but tunnel argv through `ssh user@host -- ...`.
//
// `id` here is the host machine, not a UDID — the adapter for adb/xcrun
// passes the device UDID into the argv (e.g. ['adb', '-s', '<udid>', 'shell', ...]).
export class LocalDevice implements DeviceTransport {
  readonly kind: DeviceKind = 'android';

  constructor(
    readonly id: string,
    kind: DeviceKind = 'android',
  ) {
    (this as { kind: DeviceKind }).kind = kind;
  }

  async meta(): Promise<Record<string, string>> {
    return { host: 'local' };
  }

  async shell(argv: readonly string[], options: ShellOptions = {}): Promise<ShellResult> {
    if (argv.length === 0) {
      return {
        ok: false,
        stdout: '',
        stderr: 'empty argv',
        exitCode: null,
        signal: null,
        durationMs: 0,
      };
    }
    return spawnAwait(argv, options);
  }

  async upload(localPath: string, options: UploadOptions): Promise<string> {
    // LocalDevice has no concept of "remote"; the file is already local.
    // Adapters override this for adb-push / scp / etc.
    if (options.remotePath !== localPath) {
      const data = await readFile(localPath);
      await mkdir(dirname(options.remotePath), { recursive: true });
      await writeFile(options.remotePath, data, { mode: options.mode });
    }
    return options.remotePath;
  }

  async download(remotePath: string, localPath?: string): Promise<string> {
    if (!localPath || localPath === remotePath) return remotePath;
    const data = await readFile(remotePath);
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, data);
    return localPath;
  }

  async isAlive(): Promise<boolean> {
    return true;
  }

  async dispose(): Promise<void> {
    // No persistent resources to release.
  }
}

// Run a child process to completion. Honors AbortSignal + timeoutMs.
// Returns even on non-zero exit; caller decides whether to treat that as
// a failure.
export async function spawnAwait(
  argv: readonly string[],
  options: ShellOptions = {},
): Promise<ShellResult> {
  const [bin, ...args] = argv;
  if (!bin) {
    return {
      ok: false,
      stdout: '',
      stderr: 'empty argv',
      exitCode: null,
      signal: null,
      durationMs: 0,
    };
  }
  const startedAt = Date.now();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  return await new Promise<ShellResult>((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, args, {
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({
        ok: false,
        stdout: '',
        stderr: `spawn failed: ${message}`,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    let killed = false;
    const onAbort = (): void => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // process already dead
      }
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    let timer: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        killed = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, options.timeoutMs);
      timer.unref?.();
    }

    if (options.input !== undefined) {
      try {
        child.stdin.end(options.input);
      } catch {
        // pipe may already be closed
      }
    } else {
      child.stdin.end();
    }

    child.stdout.on('data', (b: Buffer) => stdoutChunks.push(b));
    child.stderr.on('data', (b: Buffer) => stderrChunks.push(b));

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString(options.binaryStdout ? 'base64' : 'utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8') + `\nspawn error: ${err.message}`,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      const stdout = Buffer.concat(stdoutChunks).toString(options.binaryStdout ? 'base64' : 'utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      resolve({
        ok: !killed && code === 0,
        stdout,
        stderr,
        exitCode: code,
        signal: signal ?? null,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

// Random suffix for temp files we push to /sdcard/ etc.
export function randomTempName(prefix: string, ext = ''): string {
  const tag = randomBytes(6).toString('hex');
  return `${prefix}-${tag}${ext}`;
}

// Cross-platform temp file in the host OS tmp dir.
export function localTempPath(prefix: string, ext = ''): string {
  return join(tmpdir(), 'flutter-ultra-mcp', randomTempName(prefix, ext));
}

// Best-effort temp cleanup (ignore ENOENT).
export async function safeUnlink(path: string): Promise<void> {
  await rm(path, { force: true, maxRetries: 2 }).catch(() => undefined);
}
