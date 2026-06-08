// SshTransport — SSH connection pool for remote mobile device hosts.
//
// Wraps a single pooled ssh2.Client with lazy init, auto-reconnect on close,
// and SSH-level keepalives. Provides exec, uploadFile, downloadFile, and
// readRemoteFile over that connection.
//
// Usage:
//   const transport = new SshTransport(parseSshConfigFromEnv()!);
//   const exec = createSshExecFn(transport);
//   const result = await exec(['adb', 'devices']);

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from 'ssh2';
import type { ClientChannel, SFTPWrapper, ClientErrorExtensions } from 'ssh2';
import type { ShellResult, ShellOptions } from './device.js';

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const KEEPALIVE_INTERVAL_MS = 10_000;
const KEEPALIVE_COUNT_MAX = 3;

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
}

export type ExecFn = (argv: readonly string[], options?: ShellOptions) => Promise<ShellResult>;

export class SshTransport {
  readonly label: string;

  private readonly config: SshConfig;
  private conn: Client | null = null;
  private connectPromise: Promise<Client> | null = null;

  constructor(config: SshConfig) {
    this.config = config;
    this.label = `ssh://${config.username}@${config.host}:${config.port}`;
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
    const keyPath = this.config.privateKeyPath.startsWith('~/')
      ? resolve(homedir(), this.config.privateKeyPath.slice(2))
      : this.config.privateKeyPath;
    const privateKey = await readFile(keyPath);
    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      client
        .on('ready', () => resolve(client))
        .on('error', (err: Error & ClientErrorExtensions) => reject(err))
        .on('close', () => {
          if (this.conn === client) this.conn = null;
        })
        .connect({
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          privateKey,
          keepaliveInterval: KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: KEEPALIVE_COUNT_MAX,
        });
    });
  }

  async exec(argv: readonly string[], options: ShellOptions = {}): Promise<ShellResult> {
    const start = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const fullCmd = buildShellCommand(argv, options.env);

    const conn = await this.getConnection();

    const execOpts = options.env ? { env: options.env as NodeJS.ProcessEnv } : {};
    return new Promise<ShellResult>((resolve) => {
      conn.exec(fullCmd, execOpts, (err: Error | undefined, channel: ClientChannel) => {
        if (err) {
          resolve({
            ok: false,
            stdout: '',
            stderr: err.message,
            exitCode: null,
            signal: null,
            durationMs: Date.now() - start,
          });
          return;
        }

        let stdout = '';
        let stderr = '';
        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;

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
        if (options.signal) {
          if (options.signal.aborted) onAbort();
          else options.signal.addEventListener('abort', onAbort, { once: true });
        }

        channel.on('exit', (code: number | null, signal?: string) => {
          exitCode = code;
          if (signal) exitSignal = signal as NodeJS.Signals;
        });

        channel.on('close', () => {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
          const finalStderr =
            killed && exitCode === null
              ? stderr || `process killed (timeout=${timeoutMs}ms or aborted)`
              : stderr;
          resolve({
            ok: !killed && exitCode === 0,
            stdout,
            stderr: finalStderr,
            exitCode: killed && exitCode === null ? null : exitCode,
            signal: exitSignal,
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

  async downloadFile(remotePath: string, localPath: string): Promise<string> {
    const conn = await this.getConnection();
    return new Promise<string>((resolve, reject) => {
      conn.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
        if (err) {
          reject(err);
          return;
        }
        sftp.fastGet(remotePath, localPath, (getErr: Error | null | undefined) => {
          sftp.end();
          if (getErr) {
            reject(getErr);
            return;
          }
          resolve(localPath);
        });
      });
    });
  }

  async readRemoteFile(remotePath: string): Promise<Buffer> {
    const conn = await this.getConnection();
    return new Promise<Buffer>((resolve, reject) => {
      conn.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
        if (err) {
          reject(err);
          return;
        }
        const stream = sftp.createReadStream(remotePath);
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('error', (streamErr: Error) => {
          sftp.end();
          reject(streamErr);
        });
        stream.on('end', () => {
          sftp.end();
          resolve(Buffer.concat(chunks));
        });
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }
}

export function parseSshConfigFromEnv(): SshConfig | null {
  const host = process.env['FLUTTER_ULTRA_SSH_HOST'];
  if (!host) return null;

  const portStr = process.env['FLUTTER_ULTRA_SSH_PORT'];
  const port = portStr ? parseInt(portStr, 10) : 22;

  const username = process.env['FLUTTER_ULTRA_SSH_USER'];
  if (!username) return null;

  const privateKeyPath = process.env['FLUTTER_ULTRA_SSH_KEY'];
  if (!privateKeyPath) return null;

  return { host, port, username, privateKeyPath };
}

export function createSshExecFn(transport: SshTransport): ExecFn {
  return (argv: readonly string[], options?: ShellOptions): Promise<ShellResult> =>
    transport.exec(argv, options);
}

function buildShellCommand(
  argv: readonly string[],
  env?: Readonly<Record<string, string>>,
): string {
  if (argv.length === 0) return '';
  const parts = argv.map(shellQuote);
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
  return `'${s.replace(/'/g, "'\\''")}'`;
}
