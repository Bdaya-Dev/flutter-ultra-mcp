import type { Device, LegacyDevice, ExecResult } from './types.js';

export class LegacyDeviceAdapter implements LegacyDevice {
  constructor(private readonly device: Device) {}

  get label(): string {
    return this.device.id;
  }

  get isLocal(): boolean {
    return this.device.kind === 'local';
  }

  async exec(
    cmd: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<ExecResult> {
    return this.device.exec(cmd, options);
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    return this.device.uploadFile(localPath, remotePath);
  }

  async fileExists(remotePath: string): Promise<boolean> {
    const result = await this.device.exec(['test', '-e', remotePath]);
    return result.exitCode === 0;
  }

  async openRpcStream(
    host: string,
    port: number,
  ): Promise<{ localPort: number; close: () => Promise<void> }> {
    const fwd = await this.device.forwardTcpPort(host, port);
    return { localPort: fwd.localPort, close: () => fwd.close() };
  }
}

export class CanonicalDeviceAdapter implements Device {
  readonly id: string;
  readonly kind: 'local' | 'wsl' | 'ssh';
  readonly platform: 'windows' | 'darwin' | 'linux' | 'android' | 'ios';

  constructor(
    private readonly legacy: LegacyDevice,
    opts: {
      id: string;
      kind: 'local' | 'wsl' | 'ssh';
      platform: 'windows' | 'darwin' | 'linux' | 'android' | 'ios';
    },
  ) {
    this.id = opts.id;
    this.kind = opts.kind;
    this.platform = opts.platform;
  }

  async exec(
    cmd: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<ExecResult> {
    return this.legacy.exec(cmd, options);
  }

  async spawn(): Promise<never> {
    throw new Error('spawn() not available via LegacyDevice adapter — migrate to canonical Device');
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    return this.legacy.uploadFile(localPath, remotePath);
  }

  async downloadFile(): Promise<never> {
    throw new Error(
      'downloadFile() not available via LegacyDevice adapter — migrate to canonical Device',
    );
  }

  async listDir(): Promise<never> {
    throw new Error(
      'listDir() not available via LegacyDevice adapter — migrate to canonical Device',
    );
  }

  async forwardTcpPort(remoteHost: string, remotePort: number) {
    if (this.legacy.openRpcStream) {
      const stream = await this.legacy.openRpcStream(remoteHost, remotePort);
      return { localPort: stream.localPort, close: stream.close };
    }
    throw new Error('forwardTcpPort() not available — legacy device has no openRpcStream');
  }

  async probe() {
    const result = await this.legacy.exec(['uname', '-a']);
    return {
      reachable: result.exitCode === 0,
      platform: result.stdout.includes('Darwin')
        ? 'Darwin'
        : result.stdout.includes('Linux')
          ? 'Linux'
          : 'Windows',
      errors: result.exitCode !== 0 ? [`probe failed: ${result.stderr}`] : [],
    };
  }

  async close(): Promise<void> {}
}
