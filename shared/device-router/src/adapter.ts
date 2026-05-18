/**
 * Adapter between the canonical §23.3 Device interface and worker-J's legacy
 * Device shape (label/isLocal/exec/uploadFile/fileExists/openRpcStream).
 *
 * Existing native-desktop backends can consume either shape via this adapter.
 */

import type { Device, LegacyDevice, ExecResult } from './types.js';

/**
 * Wrap a canonical Device as a LegacyDevice so existing code that expects
 * the v1 shape (label/isLocal/exec/uploadFile/fileExists/openRpcStream)
 * can consume it without changes.
 */
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

/**
 * Wrap a LegacyDevice as a canonical Device. Only exec, uploadFile, and
 * forwardTcpPort (via openRpcStream) are available; other methods throw
 * with a clear migration message.
 */
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

  async close(): Promise<void> {
    // Legacy devices have no close
  }
}
