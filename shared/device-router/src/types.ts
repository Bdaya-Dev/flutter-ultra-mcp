import { z } from 'zod';

// ── Exec ────────────────────────────────────────────────────────────────────

export interface ExecOptions {
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  stdin?: string | undefined;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// ── Spawn (long-running) ────────────────────────────────────────────────────

export interface SpawnOptions {
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
  onStdoutLine?: ((line: string) => void) | undefined;
  onStderrLine?: ((line: string) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export interface DeviceProcess {
  readonly pid: number | undefined;
  kill(signal?: NodeJS.Signals): void;
  wait(): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  writeStdin(data: string): void;
}

// ── Port forwarding ─────────────────────────────────────────────────────────

export interface PortForward {
  readonly localPort: number;
  close(): Promise<void>;
}

// ── Probe ───────────────────────────────────────────────────────────────────

export interface DeviceProbeResult {
  reachable: boolean;
  platform: string;
  flutterVersion?: string | undefined;
  dartVersion?: string | undefined;
  errors: string[];
}

// ── Dir listing ─────────────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

// ── Device interface ────────────────────────────────────────────────────────

export type DeviceKind = 'local' | 'wsl' | 'ssh';
export type DevicePlatform = 'windows' | 'darwin' | 'linux' | 'android' | 'ios';

export interface Device {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly platform: DevicePlatform;

  exec(cmd: string[], options?: ExecOptions): Promise<ExecResult>;
  spawn(cmd: string[], options?: SpawnOptions): Promise<DeviceProcess>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
  listDir(remotePath: string): Promise<DirEntry[]>;
  forwardTcpPort(remoteHost: string, remotePort: number): Promise<PortForward>;
  probe(): Promise<DeviceProbeResult>;
  close(): Promise<void>;
}

// ── Connection specs (Zod-validated input from MCP tools) ───────────────────

export const WslConnectSpec = z.object({
  kind: z.literal('wsl'),
  distro: z.string().min(1),
});
export type WslConnectSpec = z.infer<typeof WslConnectSpec>;

export const SshConnectSpec = z.object({
  kind: z.literal('ssh'),
  host: z.string().min(1),
  user: z.string().min(1),
  port: z.number().int().positive().optional(),
  identityFile: z.string().optional(),
});
export type SshConnectSpec = z.infer<typeof SshConnectSpec>;

export const ConnectSpec = z.discriminatedUnion('kind', [WslConnectSpec, SshConnectSpec]);
export type ConnectSpec = z.infer<typeof ConnectSpec>;

// ── Device summary (returned by list_devices) ───────────────────────────────

export interface DeviceSummary {
  id: string;
  kind: DeviceKind;
  platform: DevicePlatform;
  label: string;
}

// ── Legacy adapter types (worker-J's v1 Device shape) ───────────────────────

export interface LegacyDevice {
  readonly label: string;
  readonly isLocal: boolean;
  exec(
    cmd: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<ExecResult>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  fileExists(remotePath: string): Promise<boolean>;
  openRpcStream?(
    host: string,
    port: number,
  ): Promise<{ localPort: number; close: () => Promise<void> }>;
}
