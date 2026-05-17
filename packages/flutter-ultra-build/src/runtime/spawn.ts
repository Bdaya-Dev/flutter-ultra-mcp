/**
 * Cross-platform child-process spawn helper with structured capture, timeout,
 * and AbortSignal-driven cancellation (plan §17.7).
 *
 * - Buffers stdout / stderr (capped at 8MB each by default).
 * - Sends SIGTERM on cancel; SIGKILL after 2s grace.
 * - Returns `{exitCode, signal, stdout, stderr, durationMs, timedOut}` — never
 *   throws on non-zero exit. Tools decide what's an error.
 * - `onStdoutLine` / `onStderrLine` allow progress parsing without buffering
 *   the whole output.
 */

import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { log } from './logger.js';

export interface SpawnOptions {
  cmd: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Soft cap after which we send SIGTERM; default 5 min. Watchdog enforces hard cap. */
  timeoutMs?: number;
  /** Cap per-stream bytes captured; default 8MB. Excess truncated with marker. */
  maxBufferBytes?: number;
  /** Line callback for live progress parsing. Lines are LF-terminated, decoded utf-8. */
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** When provided, cancellation aborts the spawn and kills the child. */
  signal?: AbortSignal;
  /** stdin payload (e.g., short `q\n` for graceful flutter-machine shutdown). */
  stdin?: string;
}

export interface SpawnResult {
  cmd: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
}

const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

class LineSplitter {
  private remainder = '';
  constructor(private readonly cb: (line: string) => void) {}
  push(chunk: string): void {
    const combined = this.remainder + chunk;
    const lines = combined.split(/\r?\n/);
    this.remainder = lines.pop() ?? '';
    for (const line of lines) this.cb(line);
  }
  flush(): void {
    if (this.remainder.length > 0) {
      this.cb(this.remainder);
      this.remainder = '';
    }
  }
}

export async function spawnCapture(opts: SpawnOptions): Promise<SpawnResult> {
  const maxBuffer = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const started = Date.now();

  const child = spawn(opts.cmd, opts.args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });

  let stdoutBuf: Buffer[] = [];
  let stderrBuf: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncatedStdout = false;
  let truncatedStderr = false;

  const stdoutSplitter = opts.onStdoutLine ? new LineSplitter(opts.onStdoutLine) : undefined;
  const stderrSplitter = opts.onStderrLine ? new LineSplitter(opts.onStderrLine) : undefined;

  child.stdout?.on('data', (chunk: Buffer) => {
    if (stdoutBytes + chunk.length <= maxBuffer) {
      stdoutBuf.push(chunk);
      stdoutBytes += chunk.length;
    } else if (!truncatedStdout) {
      truncatedStdout = true;
      const remaining = maxBuffer - stdoutBytes;
      if (remaining > 0) {
        stdoutBuf.push(chunk.subarray(0, remaining));
        stdoutBytes += remaining;
      }
    }
    if (stdoutSplitter) stdoutSplitter.push(chunk.toString('utf8'));
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderrBytes + chunk.length <= maxBuffer) {
      stderrBuf.push(chunk);
      stderrBytes += chunk.length;
    } else if (!truncatedStderr) {
      truncatedStderr = true;
      const remaining = maxBuffer - stderrBytes;
      if (remaining > 0) {
        stderrBuf.push(chunk.subarray(0, remaining));
        stderrBytes += remaining;
      }
    }
    if (stderrSplitter) stderrSplitter.push(chunk.toString('utf8'));
  });

  if (opts.stdin !== undefined && child.stdin) {
    child.stdin.write(opts.stdin);
    child.stdin.end();
  }

  let timedOut = false;
  const killTree = (sig: NodeJS.Signals) => {
    if (child.killed || child.exitCode !== null) return;
    try {
      child.kill(sig);
    } catch (err) {
      log.warn('child kill failed', { err: err instanceof Error ? err.message : String(err) });
    }
  };

  const timer = setTimeout(() => {
    timedOut = true;
    killTree('SIGTERM');
    setTimeout(() => killTree('SIGKILL'), 2000).unref();
  }, timeoutMs);
  timer.unref();

  const onAbort = () => {
    killTree('SIGTERM');
    setTimeout(() => killTree('SIGKILL'), 2000).unref();
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, sig) => resolve({ code, signal: sig }));
    },
  );

  clearTimeout(timer);
  if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  stdoutSplitter?.flush();
  stderrSplitter?.flush();

  const stdout = Buffer.concat(stdoutBuf).toString('utf8');
  const stderr = Buffer.concat(stderrBuf).toString('utf8');
  stdoutBuf = [];
  stderrBuf = [];

  return {
    cmd: opts.cmd,
    args: opts.args,
    cwd: opts.cwd,
    exitCode: exit.code,
    signal: exit.signal,
    stdout: truncatedStdout ? stdout + '\n…[stdout truncated]\n' : stdout,
    stderr: truncatedStderr ? stderr + '\n…[stderr truncated]\n' : stderr,
    durationMs: Date.now() - started,
    timedOut,
    truncatedStdout,
    truncatedStderr,
  };
}

/** Render a non-zero exit result as a CallToolResult text block. */
export function spawnFailureText(r: SpawnResult): string {
  const head =
    `Command failed: ${r.cmd} ${r.args.join(' ')}\n` +
    `  cwd: ${r.cwd}\n` +
    `  exitCode: ${r.exitCode}` +
    (r.signal ? ` signal: ${r.signal}` : '') +
    (r.timedOut ? ' (timed out)' : '') +
    `\n  durationMs: ${r.durationMs}\n`;
  const tail = r.stderr.length > 0 ? `\n--- stderr ---\n${r.stderr}` : '';
  return head + (r.stdout.length > 0 ? `\n--- stdout ---\n${r.stdout}` : '') + tail;
}
