import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type {
  Device,
  DeviceProbeResult,
  DeviceProcess,
  DirEntry,
  ExecOptions,
  ExecResult,
  PortForward,
  SpawnOptions,
} from './types.js';

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

/**
 * Convert a Windows path to a WSL-accessible path.
 * C:\foo\bar → /mnt/c/foo/bar
 */
function windowsToWslPath(winPath: string): string {
  const normalized = winPath.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):(.*)/);
  if (match) {
    return `/mnt/${match[1].toLowerCase()}${match[2]}`;
  }
  return normalized;
}

/**
 * Convert a WSL path to a Windows UNC path via \\wsl$\<distro>\<path>.
 */
function wslToWindowsUncPath(wslPath: string, distro: string): string {
  return `\\\\wsl$\\${distro}${wslPath.replace(/\//g, '\\')}`;
}

export class WslDevice implements Device {
  readonly id: string;
  readonly kind = 'wsl' as const;
  readonly platform = 'linux' as const;

  constructor(private readonly distro: string) {
    this.id = `wsl:${distro}`;
  }

  private wslArgs(cmd: string[]): string[] {
    return ['-d', this.distro, '-e', ...cmd];
  }

  async exec(cmd: string[], options?: ExecOptions): Promise<ExecResult> {
    const started = Date.now();
    const wslCmd = this.wslArgs(cmd);

    return new Promise<ExecResult>((resolve) => {
      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      if (options?.env) Object.assign(env, options.env);
      if (options?.cwd) {
        env['WSLENV'] = (env['WSLENV'] ?? '') + ':WSLCWD';
        env['WSLCWD'] = windowsToWslPath(options.cwd);
      }

      const child = nodeSpawn('wsl.exe', wslCmd, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
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
    const wslCmd = this.wslArgs(cmd);

    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (options?.env) Object.assign(env, options.env);

    const child: ChildProcess = nodeSpawn('wsl.exe', wslCmd, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
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
    const uncPath = wslToWindowsUncPath(remotePath, this.distro);
    const parentDir = wslToWindowsUncPath(path.posix.dirname(remotePath), this.distro);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.copyFile(localPath, uncPath);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const uncPath = wslToWindowsUncPath(remotePath, this.distro);
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.copyFile(uncPath, localPath);
  }

  async listDir(remotePath: string): Promise<DirEntry[]> {
    const result = await this.exec(['ls', '-1F', remotePath]);
    if (result.exitCode !== 0) {
      throw new Error(`listDir failed on ${this.id}: ${result.stderr}`);
    }
    return result.stdout
      .split('\n')
      .filter((l) => l.length > 0)
      .map((line) => {
        const isDir = line.endsWith('/');
        return {
          name: isDir ? line.slice(0, -1) : line.replace(/[*@|=]$/, ''),
          isDirectory: isDir,
        };
      });
  }

  async forwardTcpPort(remoteHost: string, remotePort: number): Promise<PortForward> {
    if (remoteHost === 'localhost' || remoteHost === '127.0.0.1' || remoteHost === '::1') {
      return { localPort: remotePort, close: async () => {} };
    }
    throw new Error(
      `WSL non-loopback forwarding not implemented (requested ${remoteHost}:${remotePort})`,
    );
  }

  async probe(): Promise<DeviceProbeResult> {
    const errors: string[] = [];

    const uname = await this.exec(['uname', '-a']);
    if (uname.exitCode !== 0) {
      return { reachable: false, platform: 'unknown', errors: [`uname failed: ${uname.stderr}`] };
    }

    const kernelVersion = await this.exec(['uname', '-r']);
    const isWsl2 =
      kernelVersion.stdout.includes('microsoft') || kernelVersion.stdout.includes('WSL2');
    if (!isWsl2) {
      errors.push('WSL1 detected — loopback sharing may not work; WSL2 recommended');
    }

    let flutterVersion: string | undefined;
    const fl = await this.exec(['flutter', '--version']);
    if (fl.exitCode === 0) {
      flutterVersion = fl.stdout.split('\n')[0]?.trim();
    } else {
      errors.push('flutter not found in WSL PATH');
    }

    let dartVersion: string | undefined;
    const dt = await this.exec(['dart', '--version']);
    if (dt.exitCode === 0) {
      dartVersion = dt.stdout.trim() || dt.stderr.trim();
    } else {
      errors.push('dart not found in WSL PATH');
    }

    return {
      reachable: true,
      platform: 'Linux',
      flutterVersion,
      dartVersion,
      errors,
    };
  }

  async close(): Promise<void> {}
}

/** List available WSL distros by parsing `wsl --list --quiet`. */
export async function listWslDistros(): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    const child = nodeSpawn('wsl.exe', ['--list', '--quiet'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => chunks.push(c));
    child.once('close', (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf16le');
      const distros = raw
        .split(/\r?\n/)
        .map((l) => l.replace(/\0/g, '').trim())
        .filter((l) => l.length > 0);
      resolve(distros);
    });
    child.once('error', () => resolve([]));
  });
}
