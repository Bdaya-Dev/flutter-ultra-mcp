import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type {
  Device,
  DevicePlatform,
  DeviceProbeResult,
  DeviceProcess,
  DirEntry,
  ExecOptions,
  ExecResult,
  PortForward,
  SpawnOptions,
} from './types.js';

function currentPlatform(): DevicePlatform {
  const p = os.platform();
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'darwin';
  return 'linux';
}

function makeAsyncIterable(stream: NodeJS.ReadableStream | null): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      if (!stream) {
        return {
          async next() {
            return { done: true, value: undefined };
          },
        };
      }
      const decoder = new TextDecoder();
      const reader = stream[Symbol.asyncIterator]?.();
      if (reader) {
        return {
          async next() {
            const r = await reader.next();
            if (r.done) return { done: true, value: undefined };
            return { done: false, value: decoder.decode(r.value as Buffer) };
          },
        };
      }
      return {
        async next() {
          return { done: true, value: undefined };
        },
      };
    },
  };
}

export class LocalDevice implements Device {
  readonly id = 'local';
  readonly kind = 'local' as const;
  readonly platform: DevicePlatform = currentPlatform();

  async exec(cmd: string[], options?: ExecOptions): Promise<ExecResult> {
    const started = Date.now();
    const [bin, ...args] = cmd;
    if (!bin) return { exitCode: 1, stdout: '', stderr: 'empty command', durationMs: 0 };

    return new Promise<ExecResult>((resolve) => {
      const child = nodeSpawn(bin, args, {
        cwd: options?.cwd,
        env: options?.env ? { ...process.env, ...options.env } : undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
      child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));

      if (options?.stdin !== undefined && child.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (options?.timeoutMs) {
        timer = setTimeout(() => {
          try {
            child.kill('SIGTERM');
          } catch {
            /* ignore */
          }
        }, options.timeoutMs);
        timer.unref();
      }

      child.once('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          durationMs: Date.now() - started,
        });
      });

      child.once('error', (err) => {
        if (timer) clearTimeout(timer);
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: err.message,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  async spawn(cmd: string[], options?: SpawnOptions): Promise<DeviceProcess> {
    const [bin, ...args] = cmd;
    if (!bin) throw new Error('empty command');

    const child: ChildProcess = nodeSpawn(bin, args, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });

    if (options?.signal) {
      const onAbort = () => {
        try {
          child.kill('SIGTERM');
        } catch {
          /* */
        }
      };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    return {
      get pid() {
        return child.pid;
      },
      kill(sig?: NodeJS.Signals) {
        child.kill(sig ?? 'SIGTERM');
      },
      wait() {
        return new Promise((resolve) => {
          child.once('close', (code, sig) => resolve({ exitCode: code, signal: sig }));
          child.once('error', () => resolve({ exitCode: 1, signal: null }));
        });
      },
      stdout: makeAsyncIterable(child.stdout),
      stderr: makeAsyncIterable(child.stderr),
      writeStdin(data: string) {
        if (child.stdin) {
          child.stdin.write(data);
        }
      },
    };
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await fs.mkdir(path.dirname(remotePath), { recursive: true });
    await fs.copyFile(localPath, remotePath);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.copyFile(remotePath, localPath);
  }

  async listDir(dirPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  }

  async forwardTcpPort(_remoteHost: string, remotePort: number): Promise<PortForward> {
    return { localPort: remotePort, close: async () => {} };
  }

  async probe(): Promise<DeviceProbeResult> {
    const errors: string[] = [];
    let flutterVersion: string | undefined;
    let dartVersion: string | undefined;

    const flutterResult = await this.exec(['flutter', '--version']);
    if (flutterResult.exitCode === 0) {
      flutterVersion = flutterResult.stdout.split('\n')[0]?.trim();
    } else {
      errors.push('flutter not found in PATH');
    }

    const dartResult = await this.exec(['dart', '--version']);
    if (dartResult.exitCode === 0) {
      dartVersion = dartResult.stdout.trim() || dartResult.stderr.trim();
    } else {
      errors.push('dart not found in PATH');
    }

    return {
      reachable: true,
      platform:
        os.platform() === 'win32' ? 'Windows' : os.platform() === 'darwin' ? 'Darwin' : 'Linux',
      flutterVersion,
      dartVersion,
      errors,
    };
  }

  async close(): Promise<void> {
    // No-op for local device
  }
}
