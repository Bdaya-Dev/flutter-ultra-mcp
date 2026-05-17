// SshDevice — placeholder for the wave-3 remote-device worker.
//
// This file documents the contract a future SshDevice MUST satisfy so the
// macOS Swift sidecar can run on a remote Mac while the MCP server
// orchestrates from any host (notably Windows).
//
// IMPLEMENTATION NOTES for the remote-device worker:
//
//   - Use `ssh2` (BSD-2-Clause, actively maintained, npm 1.16+) for the
//     transport. Avoid `node-ssh` (wrapper) unless its connection pooling
//     becomes a measurable benefit.
//   - Multiplex over a single SSH connection (`Client.exec()` per command,
//     `Client.shell()` for long-running streams). Don't re-handshake per
//     tool call; share a pooled Connection per `Device` instance.
//   - `uploadFile`: use SFTP (`Client.sftp()` → `WriteStream`). Materialize
//     remote directories with `mkdir -p` over `exec` first; sftp.mkdir does
//     not support recursive creation natively.
//   - `openRpcStream`: spawn the sidecar via `Client.exec(cmd, { pty:false })`;
//     the returned Channel doubles as stdin/stdout. Wire stderr from the
//     same Channel's `stderr` event (it's a separate stream).
//   - TCC permissioning: TCC on a remote Mac still requires a human at the
//     Mac to grant Accessibility access (no SSH path around it). The remote
//     impl returns the same `TCC_NOT_GRANTED` structured error this server
//     emits locally; the operator runs the remediation steps physically (or
//     over Screen Sharing).
//   - Auth: prefer key-based (read from `~/.ssh/...` or a project-scoped
//     key path). Surface a `SSH_KEY_PATH` env var to avoid hardcoding.
//   - Liveness: ping the channel every 30s via `exec('true')`; reconnect on
//     drop with exponential backoff (1s, 2s, 4s, 8s, cap at 60s).
//
// The class signature below is intentionally NOT exported (no consumers
// expect SshDevice today). Keep this file in the repo so the future worker
// has a starting point and the contract stays in source.

import type { Device, ExecOptions, ExecResult, RpcStream } from './types.js';

// Exported so the type-checker treats it as used; the future remote-device
// worker will replace this class body, keeping the name.
export class SshDeviceStub implements Device {
  readonly label: string;
  readonly isLocal = false;
  constructor(host: string, user: string) {
    this.label = `ssh://${user}@${host}`;
  }
  exec(_cmd: string, _args: readonly string[], _opts?: ExecOptions): Promise<ExecResult> {
    throw new Error('SshDevice not implemented; see ssh.stub.ts for the wave-3 contract.');
  }
  uploadFile(_localPath: string, _remotePath: string): Promise<string> {
    throw new Error('SshDevice not implemented.');
  }
  fileExists(_remotePath: string): Promise<boolean> {
    throw new Error('SshDevice not implemented.');
  }
  openRpcStream(_cmd: string, _args: readonly string[], _opts?: ExecOptions): Promise<RpcStream> {
    throw new Error('SshDevice not implemented.');
  }
}
