// Device abstraction — placeholder until @flutter-ultra/device-router lands
// (worker Q, post-wave-3). The interface mirrors the approved spec at
// .omc/research/flutter-ultra-remote-device-support-2026-05-17.md so the
// AT-SPI bridge wiring is a no-op swap once the real package ships.
//
// Today: only `LocalLinuxDevice` is implemented. It calls `child_process`
// directly. Tomorrow: `WslDevice` wraps every command with
// `wsl.exe -d <distro> -e ...`, `SshDevice` wraps with `ssh user@host ...`.
// The TS server holds a `Device` reference and never branches on `kind`.

import {
  spawn as childSpawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions as NodeSpawnOptions,
} from 'node:child_process';

export type DeviceKind = 'local' | 'wsl' | 'ssh';
export type DevicePlatform = 'linux' | 'darwin' | 'win32';

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  input?: string;
}

export interface ExecResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface DeviceProcess {
  readonly child: ChildProcessWithoutNullStreams;
  kill(signal?: NodeJS.Signals): boolean;
  waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface DeviceProbeResult {
  platform: DevicePlatform;
  reachable: boolean;
  notes: string[];
}

export interface PortForward {
  localPort: number;
  close(): Promise<void>;
}

export interface Device {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly platform: DevicePlatform;

  exec(cmd: readonly string[], options?: ExecOptions): Promise<ExecResult>;
  spawn(cmd: readonly string[], options?: SpawnOptions): Promise<DeviceProcess>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
  forwardTcpPort(remoteHost: string, remotePort: number): Promise<PortForward>;
  probe(): Promise<DeviceProbeResult>;
  close(): Promise<void>;
}

// --- LocalLinuxDevice -------------------------------------------------------

export class LocalLinuxDevice implements Device {
  readonly id = 'local';
  readonly kind: DeviceKind = 'local';
  readonly platform: DevicePlatform = 'linux';

  async exec(cmd: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
    if (cmd.length === 0) {
      throw new Error('cmd must contain at least one argument (the executable name)');
    }
    const [bin, ...args] = cmd;
    return new Promise<ExecResult>((resolve, reject) => {
      const spawnOptions: NodeSpawnOptions = {
        cwd: options.cwd ?? process.cwd(),
        env: options.env !== undefined ? { ...process.env, ...options.env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      };
      const child = childSpawn(bin as string, args, spawnOptions);
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer =
        options.timeoutMs !== undefined && options.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGKILL');
            }, options.timeoutMs)
          : null;
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.once('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
      child.once('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`exec timed out after ${options.timeoutMs}ms: ${cmd.join(' ')}`));
          return;
        }
        resolve({ exitCode: code, signal, stdout, stderr });
      });
      if (options.input !== undefined && child.stdin) {
        child.stdin.write(options.input);
        child.stdin.end();
      }
    });
  }

  async spawn(cmd: readonly string[], options: SpawnOptions = {}): Promise<DeviceProcess> {
    if (cmd.length === 0) {
      throw new Error('cmd must contain at least one argument');
    }
    const [bin, ...args] = cmd;
    const spawnOptions: NodeSpawnOptions = {
      cwd: options.cwd ?? process.cwd(),
      env: options.env !== undefined ? { ...process.env, ...options.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    };
    const child = childSpawn(bin as string, args, spawnOptions) as ChildProcessWithoutNullStreams;
    // Wait for the OS spawn to succeed (or fail) before returning a handle.
    // Without this, an ENOENT bubbles as an unhandled-error event on the
    // child stream before any caller listener is wired up.
    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError);
        resolve();
      };
      const onError = (err: Error): void => {
        child.off('spawn', onSpawn);
        reject(err);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
    return {
      child,
      kill: (signal: NodeJS.Signals = 'SIGTERM') => child.kill(signal),
      waitForExit: () =>
        new Promise((resolve) => {
          child.once('close', (code, signal) => resolve({ code, signal }));
        }),
    };
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    // Local device → both paths are on the same filesystem.
    const { promises: fs } = await import('node:fs');
    await fs.copyFile(localPath, remotePath);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const { promises: fs } = await import('node:fs');
    await fs.copyFile(remotePath, localPath);
  }

  async forwardTcpPort(_remoteHost: string, remotePort: number): Promise<PortForward> {
    // Local device → no tunnel; the "remote" port IS the local port.
    return {
      localPort: remotePort,
      close: async () => {
        // No tunnel to tear down.
      },
    };
  }

  async probe(): Promise<DeviceProbeResult> {
    const notes: string[] = [];
    if (process.platform !== 'linux') {
      notes.push(
        `host platform is ${process.platform}; LocalLinuxDevice will execute as-if local Linux but the AT-SPI bridge will fail to import gi.repository.Atspi`,
      );
      return { platform: 'linux', reachable: false, notes };
    }
    return { platform: 'linux', reachable: true, notes };
  }

  async close(): Promise<void> {
    // No state to close.
  }
}

// --- Placeholder constructors for siblings ---------------------------------
//
// Worker Q ships @flutter-ultra/device-router with real impls. We export
// the type names here so MCP tools that take a `deviceId` argument can
// already advertise the future surface without breaking when WslDevice
// arrives. Calling new WslDevice() before that ships throws.

export class WslDevice implements Device {
  readonly id: string;
  readonly kind: DeviceKind = 'wsl';
  readonly platform: DevicePlatform = 'linux';

  constructor(public readonly distro: string) {
    this.id = `wsl:${distro}`;
    throw new Error(
      'WslDevice is not implemented in this package — it ships in @flutter-ultra/device-router (post-wave-3, worker Q).',
    );
  }

  exec(): Promise<ExecResult> {
    throw new Error('not implemented');
  }
  spawn(): Promise<DeviceProcess> {
    throw new Error('not implemented');
  }
  uploadFile(): Promise<void> {
    throw new Error('not implemented');
  }
  downloadFile(): Promise<void> {
    throw new Error('not implemented');
  }
  forwardTcpPort(): Promise<PortForward> {
    throw new Error('not implemented');
  }
  probe(): Promise<DeviceProbeResult> {
    throw new Error('not implemented');
  }
  close(): Promise<void> {
    throw new Error('not implemented');
  }
}

export class SshDevice implements Device {
  readonly id: string;
  readonly kind: DeviceKind = 'ssh';
  readonly platform: DevicePlatform = 'linux';

  constructor(public readonly target: string) {
    this.id = `ssh:${target}`;
    throw new Error(
      'SshDevice is not implemented in this package — it ships in @flutter-ultra/device-router (post-wave-3, worker Q).',
    );
  }

  exec(): Promise<ExecResult> {
    throw new Error('not implemented');
  }
  spawn(): Promise<DeviceProcess> {
    throw new Error('not implemented');
  }
  uploadFile(): Promise<void> {
    throw new Error('not implemented');
  }
  downloadFile(): Promise<void> {
    throw new Error('not implemented');
  }
  forwardTcpPort(): Promise<PortForward> {
    throw new Error('not implemented');
  }
  probe(): Promise<DeviceProbeResult> {
    throw new Error('not implemented');
  }
  close(): Promise<void> {
    throw new Error('not implemented');
  }
}
