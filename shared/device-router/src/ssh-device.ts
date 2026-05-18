import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
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

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('failed to get port')));
      }
    });
    srv.on('error', reject);
  });
}

export interface SshSpec {
  host: string;
  user: string;
  port?: number | undefined;
  identityFile?: string | undefined;
}

export class SshDevice implements Device {
  readonly id: string;
  readonly kind = 'ssh' as const;
  private _platform: DevicePlatform = 'linux';
  private controlPath: string;
  private connected = false;
  private activeTunnels: Array<{ localPort: number; remoteSpec: string }> = [];

  constructor(private readonly spec: SshSpec) {
    this.id = `ssh:${spec.user}@${spec.host}`;
    // On Windows, OpenSSH doesn't support Unix socket ControlPath — use a named pipe path
    // via a temp directory. On Unix, use tmpdir.
    const suffix = randomUUID().slice(0, 8);
    if (os.platform() === 'win32') {
      this.controlPath = path.join(os.tmpdir(), `fu-ssh-${suffix}`);
    } else {
      this.controlPath = path.join(os.tmpdir(), `fu-ssh-${suffix}.sock`);
    }
  }

  get platform(): DevicePlatform {
    return this._platform;
  }

  private sshBaseArgs(): string[] {
    const args: string[] = [
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ControlMaster=auto',
      '-o',
      `ControlPath=${this.controlPath}`,
      '-o',
      'ControlPersist=10m',
    ];
    if (this.spec.identityFile) {
      args.push('-i', this.spec.identityFile);
    }
    if (this.spec.port) {
      args.push('-p', String(this.spec.port));
    }
    return args;
  }

  private target(): string {
    return `${this.spec.user}@${this.spec.host}`;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;

    // Open a ControlMaster background session
    const args = [...this.sshBaseArgs(), '-N', '-f', this.target()];
    const result = await this.sshExec(args);
    if (result.exitCode !== 0) {
      throw new Error(`SSH ControlMaster failed: ${result.stderr}`);
    }
    this.connected = true;
  }

  private sshExec(args: string[]): Promise<ExecResult> {
    const started = Date.now();
    return new Promise<ExecResult>((resolve) => {
      const child = nodeSpawn('ssh', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
      child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));
      child.once('close', (code) => {
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          durationMs: Date.now() - started,
        });
      });
      child.once('error', (err) => {
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: err.message,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  async exec(cmd: string[], options?: ExecOptions): Promise<ExecResult> {
    await this.ensureConnected();
    const started = Date.now();

    const sshArgs = [...this.sshBaseArgs(), this.target()];
    if (options?.cwd) {
      sshArgs.push('--', `cd ${shellEscape(options.cwd)} &&`, ...cmd);
    } else {
      sshArgs.push('--', ...cmd);
    }

    return new Promise<ExecResult>((resolve) => {
      const child = nodeSpawn('ssh', sshArgs, {
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
    await this.ensureConnected();

    const sshArgs = [...this.sshBaseArgs(), this.target(), '--', ...cmd];

    const child: ChildProcess = nodeSpawn('ssh', sshArgs, {
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
    await this.ensureConnected();
    // Ensure remote parent dir exists
    const remoteDir = path.posix.dirname(remotePath);
    await this.exec(['mkdir', '-p', remoteDir]);

    const scpArgs = [
      '-o',
      `ControlPath=${this.controlPath}`,
      '-o',
      'BatchMode=yes',
      ...(this.spec.port ? ['-P', String(this.spec.port)] : []),
      localPath,
      `${this.target()}:${remotePath}`,
    ];
    const scpResult = await this.scpExec(scpArgs);
    if (scpResult.exitCode !== 0) {
      throw new Error(`scp upload failed: ${scpResult.stderr}`);
    }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await this.ensureConnected();
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    const scpArgs = [
      '-o',
      `ControlPath=${this.controlPath}`,
      '-o',
      'BatchMode=yes',
      ...(this.spec.port ? ['-P', String(this.spec.port)] : []),
      `${this.target()}:${remotePath}`,
      localPath,
    ];
    const scpResult = await this.scpExec(scpArgs);
    if (scpResult.exitCode !== 0) {
      throw new Error(`scp download failed: ${scpResult.stderr}`);
    }
  }

  private scpExec(args: string[]): Promise<ExecResult> {
    const started = Date.now();
    return new Promise<ExecResult>((resolve) => {
      const child = nodeSpawn('scp', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
      child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));
      child.once('close', (code) => {
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          durationMs: Date.now() - started,
        });
      });
      child.once('error', (err) => {
        resolve({ exitCode: 1, stdout: '', stderr: err.message, durationMs: Date.now() - started });
      });
    });
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
    await this.ensureConnected();
    const localPort = await getAvailablePort();

    const forwardArgs = [
      '-o',
      `ControlPath=${this.controlPath}`,
      '-O',
      'forward',
      '-L',
      `${localPort}:${remoteHost}:${remotePort}`,
      this.target(),
    ];
    const result = await this.sshExec(forwardArgs);
    if (result.exitCode !== 0) {
      throw new Error(`SSH port forward failed: ${result.stderr}`);
    }

    const spec = `${localPort}:${remoteHost}:${remotePort}`;
    this.activeTunnels.push({ localPort, remoteSpec: spec });

    return {
      localPort,
      close: async () => {
        const cancelArgs = [
          '-o',
          `ControlPath=${this.controlPath}`,
          '-O',
          'cancel',
          '-L',
          spec,
          this.target(),
        ];
        await this.sshExec(cancelArgs);
        this.activeTunnels = this.activeTunnels.filter((t) => t.remoteSpec !== spec);
      },
    };
  }

  async probe(): Promise<DeviceProbeResult> {
    const errors: string[] = [];

    try {
      await this.ensureConnected();
    } catch (err) {
      return {
        reachable: false,
        platform: 'unknown',
        errors: [`Connection failed: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    const uname = await this.exec(['uname', '-a']);
    if (uname.exitCode !== 0) {
      return { reachable: false, platform: 'unknown', errors: [`uname failed: ${uname.stderr}`] };
    }

    const platformStr = uname.stdout.includes('Darwin')
      ? 'Darwin'
      : uname.stdout.includes('Linux')
        ? 'Linux'
        : 'unknown';
    this._platform = platformStr === 'Darwin' ? 'darwin' : 'linux';

    let flutterVersion: string | undefined;
    const fl = await this.exec(['flutter', '--version']);
    if (fl.exitCode === 0) {
      flutterVersion = fl.stdout.split('\n')[0]?.trim();
    } else {
      errors.push('flutter not found in remote PATH');
    }

    let dartVersion: string | undefined;
    const dt = await this.exec(['dart', '--version']);
    if (dt.exitCode === 0) {
      dartVersion = dt.stdout.trim() || dt.stderr.trim();
    } else {
      errors.push('dart not found in remote PATH');
    }

    return {
      reachable: true,
      platform: platformStr,
      flutterVersion,
      dartVersion,
      errors,
    };
  }

  async close(): Promise<void> {
    if (!this.connected) return;

    // Cancel all active tunnels
    for (const tunnel of [...this.activeTunnels]) {
      try {
        const cancelArgs = [
          '-o',
          `ControlPath=${this.controlPath}`,
          '-O',
          'cancel',
          '-L',
          tunnel.remoteSpec,
          this.target(),
        ];
        await this.sshExec(cancelArgs);
      } catch {
        /* best-effort */
      }
    }
    this.activeTunnels = [];

    // Close ControlMaster
    try {
      const exitArgs = ['-o', `ControlPath=${this.controlPath}`, '-O', 'exit', this.target()];
      await this.sshExec(exitArgs);
    } catch {
      /* best-effort */
    }

    this.connected = false;

    // Clean up socket file
    try {
      await fs.unlink(this.controlPath);
    } catch {
      /* may already be gone */
    }
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Parse SSH config file and return named Host entries. */
export async function listSshHosts(): Promise<
  Array<{
    host: string;
    user?: string | undefined;
    port?: number | undefined;
    identityFile?: string | undefined;
  }>
> {
  const configPath = path.join(os.homedir(), '.ssh', 'config');
  let content: string;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch {
    return [];
  }

  const hosts: Array<{
    host: string;
    user?: string | undefined;
    port?: number | undefined;
    identityFile?: string | undefined;
  }> = [];
  let current: {
    host: string;
    user?: string | undefined;
    port?: number | undefined;
    identityFile?: string | undefined;
  } | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(\w+)\s+(.+)$/);
    if (!match) continue;
    const [, key, value] = match;

    if (key?.toLowerCase() === 'host') {
      if (current) hosts.push(current);
      // Skip wildcard entries
      if (value?.includes('*') || value?.includes('?')) {
        current = null;
      } else {
        current = { host: value! };
      }
    } else if (current) {
      switch (key?.toLowerCase()) {
        case 'user':
          current.user = value;
          break;
        case 'port':
          current.port = parseInt(value!, 10) || undefined;
          break;
        case 'identityfile':
          current.identityFile = value?.replace(/^~/, os.homedir());
          break;
        case 'hostname':
          current.host = value!;
          break;
      }
    }
  }

  if (current) hosts.push(current);
  return hosts;
}
