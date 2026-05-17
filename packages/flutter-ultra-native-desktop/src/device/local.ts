// LocalDevice — Device implementation backed by Node child_process.
//
// Today's default. For the remote-Mac future we'll add SshDevice with the
// same surface (see ./ssh.stub.ts).

import { spawn } from 'node:child_process';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname } from 'node:path';
import type { Device, ExecOptions, ExecResult, RpcStream } from './types.js';

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;

export class LocalDevice implements Device {
  readonly label = 'local';
  readonly isLocal = true;

  async exec(cmd: string, args: readonly string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const start = Date.now();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    return new Promise<ExecResult>((resolve, reject) => {
      const spawnOpts: Parameters<typeof spawn>[2] = {
        stdio: ['ignore', 'pipe', 'pipe'],
      };
      if (opts.cwd !== undefined) spawnOpts.cwd = opts.cwd;
      if (opts.env !== undefined) spawnOpts.env = { ...process.env, ...opts.env };
      const child = spawn(cmd, args as string[], spawnOpts);

      let stdout = '';
      let stderr = '';
      let killed = false;
      const stdoutStream = child.stdout;
      const stderrStream = child.stderr;
      if (stdoutStream) {
        stdoutStream.setEncoding('utf8');
        stdoutStream.on('data', (chunk: string) => {
          stdout += chunk;
        });
      }
      if (stderrStream) {
        stderrStream.setEncoding('utf8');
        stderrStream.on('data', (chunk: string) => {
          stderr += chunk;
        });
      }

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      timer.unref?.();

      const onAbort = (): void => {
        killed = true;
        child.kill('SIGTERM');
      };
      if (opts.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }

      child.on('error', (err) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        const exitCode = code !== null ? code : signal !== null ? null : 0;
        if (killed && exitCode === null) {
          resolve({
            stdout,
            stderr: stderr || `process killed (timeout=${timeoutMs}ms or aborted)`,
            exitCode: null,
            durationMs: Date.now() - start,
          });
          return;
        }
        resolve({
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - start,
        });
      });
    });
  }

  async uploadFile(localPath: string, remotePath: string): Promise<string> {
    // Local-host upload === copy. We materialize the destination directory
    // first; consumers may pass a target inside a directory we created.
    await mkdir(dirname(remotePath), { recursive: true });
    await copyFile(localPath, remotePath);
    return remotePath;
  }

  async fileExists(remotePath: string): Promise<boolean> {
    try {
      await access(remotePath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async openRpcStream(
    cmd: string,
    args: readonly string[],
    opts: ExecOptions = {},
  ): Promise<RpcStream> {
    const spawnOpts: Parameters<typeof spawn>[2] = {
      stdio: ['pipe', 'pipe', 'pipe'],
    };
    if (opts.cwd !== undefined) spawnOpts.cwd = opts.cwd;
    if (opts.env !== undefined) spawnOpts.env = { ...process.env, ...opts.env };
    const child = spawn(cmd, args as string[], spawnOpts);

    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error(`LocalDevice.openRpcStream: failed to wire stdio for '${cmd}'`);
    }

    const exit = new Promise<number | null>((resolve) => {
      child.once('exit', (code, signal) => {
        resolve(code !== null ? code : signal !== null ? null : 0);
      });
    });

    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      pid: child.pid ?? 0,
      exit,
      async kill(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
        if (child.exitCode !== null) return;
        child.kill(signal);
        await exit;
      },
    };
  }
}
