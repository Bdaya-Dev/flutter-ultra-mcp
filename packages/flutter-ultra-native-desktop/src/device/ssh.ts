// SshDevice — Device implementation backed by an SSH connection to a remote Mac.
//
// Connects once on first use and pools the single Client connection with SSH-level
// keepalives. All Device methods tunnel over that connection:
//   exec         → conn.exec()  (collects stdout/stderr, resolves on close)
//   uploadFile   → conn.sftp() + sftp.fastPut()
//   fileExists   → conn.exec('test -f <path>')
//   openRpcStream → conn.exec() returning the live channel as RpcStream
//
// Reconnect: if the connection drops, the next call re-establishes it.
// Configuration is provided by the caller (from SshConfig via env vars).

import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import type { ClientChannel, SFTPWrapper, ClientErrorExtensions } from 'ssh2';
import type { Device, ExecOptions, ExecResult, RpcStream } from './types.js';

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const KEEPALIVE_INTERVAL_MS = 10_000;
const KEEPALIVE_COUNT_MAX = 3;

export interface SshDeviceOptions {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
}

export class SshDevice implements Device {
  readonly label: string;
  readonly isLocal = false;

  private readonly opts: SshDeviceOptions;
  private conn: Client | null = null;
  private connectPromise: Promise<Client> | null = null;

  constructor(opts: SshDeviceOptions) {
    this.opts = opts;
    this.label = `ssh://${opts.username}@${opts.host}:${opts.port}`;
  }

  private async getConnection(): Promise<Client> {
    if (this.conn !== null) return this.conn;
    if (this.connectPromise !== null) return this.connectPromise;

    this.connectPromise = this.createConnection();
    try {
      this.conn = await this.connectPromise;
      return this.conn;
    } finally {
      this.connectPromise = null;
    }
  }

  private async createConnection(): Promise<Client> {
    const privateKey = await readFile(this.opts.privateKeyPath);
    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      client
        .on('ready', () => resolve(client))
        .on('error', (err: Error & ClientErrorExtensions) => reject(err))
        .on('close', () => {
          // Clear pooled connection so the next call reconnects.
          if (this.conn === client) this.conn = null;
        })
        .connect({
          host: this.opts.host,
          port: this.opts.port,
          username: this.opts.username,
          privateKey,
          keepaliveInterval: KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: KEEPALIVE_COUNT_MAX,
        });
    });
  }

  async exec(cmd: string, args: readonly string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const start = Date.now();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const fullCmd = buildShellCommand(cmd, args, opts.env);

    const conn = await this.getConnection();

    const execOpts = opts.env ? { env: opts.env as NodeJS.ProcessEnv } : {};
    return new Promise<ExecResult>((resolve, reject) => {
      conn.exec(fullCmd, execOpts, (err: Error | undefined, channel: ClientChannel) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';
        let exitCode: number | null = null;

        channel.setEncoding('utf8');
        channel.stderr.setEncoding('utf8');

        channel.on('data', (chunk: string) => {
          stdout += chunk;
        });
        channel.stderr.on('data', (chunk: string) => {
          stderr += chunk;
        });

        let killed = false;
        const timer = setTimeout(() => {
          killed = true;
          channel.close();
        }, timeoutMs);

        const onAbort = (): void => {
          killed = true;
          channel.close();
        };
        if (opts.signal) {
          if (opts.signal.aborted) onAbort();
          else opts.signal.addEventListener('abort', onAbort, { once: true });
        }

        channel.on('exit', (code: number | null) => {
          exitCode = code;
        });

        channel.on('close', () => {
          clearTimeout(timer);
          opts.signal?.removeEventListener('abort', onAbort);
          resolve({
            stdout,
            stderr:
              killed && exitCode === null
                ? stderr || `process killed (timeout=${timeoutMs}ms or aborted)`
                : stderr,
            exitCode: killed && exitCode === null ? null : exitCode,
            durationMs: Date.now() - start,
          });
        });
      });
    });
  }

  async uploadFile(localPath: string, remotePath: string): Promise<string> {
    const conn = await this.getConnection();
    return new Promise<string>((resolve, reject) => {
      conn.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
        if (err) {
          reject(err);
          return;
        }
        sftp.fastPut(localPath, remotePath, (putErr: Error | null | undefined) => {
          sftp.end();
          if (putErr) {
            reject(putErr);
            return;
          }
          resolve(remotePath);
        });
      });
    });
  }

  async fileExists(remotePath: string): Promise<boolean> {
    const result = await this.exec('test', ['-f', remotePath], { timeoutMs: 10_000 });
    return result.exitCode === 0;
  }

  async openRpcStream(
    cmd: string,
    args: readonly string[],
    opts: ExecOptions = {},
  ): Promise<RpcStream> {
    const fullCmd = buildShellCommand(cmd, args, opts.env);
    const conn = await this.getConnection();

    const rpcExecOpts = opts.env ? { env: opts.env as NodeJS.ProcessEnv } : {};
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      conn.exec(fullCmd, rpcExecOpts, (err: Error | undefined, ch: ClientChannel) => {
        if (err) reject(err);
        else resolve(ch);
      });
    });

    const exit = new Promise<number | null>((resolve) => {
      let code: number | null = null;
      channel.on('exit', (c: number | null) => {
        code = c;
      });
      channel.on('close', () => resolve(code));
    });

    return {
      stdin: channel,
      stdout: channel,
      stderr: channel.stderr,
      pid: 0,
      exit,
      async kill(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
        void signal;
        try {
          channel.close();
        } catch {
          // ignore if already closed
        }
        await exit;
      },
    };
  }

  async disconnect(): Promise<void> {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }
}

function buildShellCommand(
  cmd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): string {
  const parts = [cmd, ...args].map(shellQuote);
  let envPrefix = '';
  if (env) {
    envPrefix =
      Object.entries(env)
        .map(([k, v]) => {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
            throw new Error(`Invalid env var name: ${k}`);
          }
          return `${k}=${shellQuote(v)}`;
        })
        .join(' ') + ' ';
  }
  return envPrefix + parts.join(' ');
}

function shellQuote(s: string): string {
  // Single-quote the string and escape any single-quotes inside it.
  return `'${s.replace(/'/g, "'\\''")}'`;
}
