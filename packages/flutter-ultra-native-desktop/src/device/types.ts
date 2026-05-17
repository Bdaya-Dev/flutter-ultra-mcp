// Device abstraction.
//
// Goal: today we run sidecars on the LOCAL host; tomorrow we run them on a
// REMOTE macOS host over SSH (e.g. a Mac mini build agent). Worker-J owns
// the macOS path; the same abstraction is consumed by Windows/Linux paths.
//
// The contract is intentionally tiny — just exec, file upload, and an
// open-rpc-stream primitive — so the SSH implementation can plug in via
// libraries like `ssh2`/`node-ssh` without leaking transport details into
// the sidecar bridge.

import type { Readable, Writable } from 'node:stream';

/** Process-execution result. exitCode is null when the process was killed. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  // Wall-clock duration in ms; useful for tests and tracing.
  durationMs: number;
}

/** Long-lived streaming RPC channel — sidecar speaks newline-delimited JSON-RPC. */
export interface RpcStream {
  /** Write to the sidecar's stdin. */
  readonly stdin: Writable;
  /** Read from the sidecar's stdout (newline-delimited JSON). */
  readonly stdout: Readable;
  /** Read from the sidecar's stderr (logs/diagnostics). */
  readonly stderr: Readable;
  /** Process id on the host (local or remote). 0 when not meaningfully available. */
  readonly pid: number;
  /** Kill the child. Resolves once the process has exited. */
  kill(signal?: NodeJS.Signals): Promise<void>;
  /** Resolves with the exit code (or null if killed by signal). */
  readonly exit: Promise<number | null>;
}

/**
 * Device — abstracts "where does this sidecar run?"
 *
 * Two implementations:
 *   - LocalDevice — child_process.spawn on the host running this MCP server.
 *   - SshDevice (stub) — ssh2-style multiplexed channel to a remote Mac.
 *
 * Future remote-Mac support: drop in an SshDevice with the same surface; the
 * sidecar bridge, TCC permission checker, and tool implementations remain
 * unchanged. The MCP server orchestrates from Windows; the Swift helper runs
 * on the remote Mac. This is the primary impact lever flagged by team-lead.
 */
export interface Device {
  /** Human-readable label, e.g. "local" or "ssh://user@mac.example.com". */
  readonly label: string;
  /** True when the device is the host running this MCP server. */
  readonly isLocal: boolean;
  /** Run a command and collect all output. */
  exec(cmd: string, args: readonly string[], opts?: ExecOptions): Promise<ExecResult>;
  /**
   * Upload a local file to the device's filesystem. On LocalDevice the
   * source and destination paths are both on the same host; on SshDevice
   * the source is on the MCP host and destination is on the remote.
   * Returns the absolute remote path written.
   */
  uploadFile(localPath: string, remotePath: string): Promise<string>;
  /**
   * Check that a file exists on the device's filesystem.
   * Used for sidecar-presence detection during capability probing.
   */
  fileExists(remotePath: string): Promise<boolean>;
  /**
   * Open a streaming RPC channel to a long-running process. Caller writes
   * JSON-RPC requests to stdin and reads responses from stdout.
   */
  openRpcStream(cmd: string, args: readonly string[], opts?: ExecOptions): Promise<RpcStream>;
}

export interface ExecOptions {
  /** Working directory on the device. */
  cwd?: string;
  /** Environment overrides (merged with device defaults). */
  env?: Readonly<Record<string, string>>;
  /** Hard timeout in ms; defaults to 60s for exec, no limit for openRpcStream. */
  timeoutMs?: number;
  /** Optional AbortSignal to cancel the command. */
  signal?: AbortSignal;
}

/** Helper: assemble a remediation string when a Device-side command fails. */
export function deviceErrorMessage(
  device: Device,
  cmd: string,
  result: ExecResult,
  remediation?: string,
): string {
  const where = device.isLocal ? 'on this machine' : `on ${device.label}`;
  const tail = result.stderr.trim() || result.stdout.trim() || '(no output)';
  const hint = remediation ? `\n\nHint: ${remediation}` : '';
  return (
    `Command '${cmd}' failed ${where} with exit code ${result.exitCode ?? 'null'}.\n` +
    `Output:\n${tail}${hint}`
  );
}
