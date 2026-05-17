// Sidecar lifecycle + line-delimited JSON-RPC 2.0 client.
//
// Each MCP tool invocation either reuses the existing sidecar process or
// spins one up lazily. We hold exactly one sidecar per Device (keyed by
// `device.id`) for the lifetime of the MCP server — AT-SPI binding init
// is expensive (200-500ms), so reuse is significant.
//
// Crash semantics: if the Python process exits unexpectedly (binding
// crash, OOM, user kill -9), in-flight requests reject with
// `SidecarCrashedError` and the cached entry is dropped. The next call
// triggers a fresh boot.

import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Device, DeviceProcess } from './device.js';

const SIDECAR_DIR_FROM_HERE = '../sidecars/linux-atspi';
const SIDECAR_MODULE = 'atspi_bridge';

export interface SidecarOptions {
  pythonBin?: string; // default: 'python3'
  sidecarDir?: string; // default: <package>/sidecars/linux-atspi
  startupTimeoutMs?: number; // default: 5000
  requestTimeoutMs?: number; // default: 15000
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class SidecarStartupError extends Error {
  constructor(
    message: string,
    public readonly stderrTail: string,
  ) {
    super(`${message}\n--- sidecar stderr tail ---\n${stderrTail}`);
    this.name = 'SidecarStartupError';
  }
}

export class SidecarRpcError extends Error {
  constructor(
    public readonly rpc: RpcError,
    public readonly method: string,
  ) {
    super(`[${method}] rpc error ${rpc.code}: ${rpc.message}`);
    this.name = 'SidecarRpcError';
  }
}

export class SidecarCrashedError extends Error {
  constructor(
    public readonly stderrTail: string,
    public readonly exitCode: number | null,
  ) {
    super(`atspi sidecar exited unexpectedly (exit=${exitCode})\n${stderrTail}`);
    this.name = 'SidecarCrashedError';
  }
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

class Sidecar {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stderrTail = '';
  private alive = true;
  private rl?: ReadlineInterface;
  private rlErr?: ReadlineInterface;

  constructor(
    private readonly proc: DeviceProcess,
    private readonly requestTimeoutMs: number,
  ) {}

  static async start(device: Device, options: SidecarOptions): Promise<Sidecar> {
    const here = fileURLToPath(import.meta.url);
    const sidecarDir = options.sidecarDir ?? join(here, '..', SIDECAR_DIR_FROM_HERE);
    const pythonBin = options.pythonBin ?? 'python3';
    const cmd = [pythonBin, '-u', '-m', SIDECAR_MODULE];

    const proc = await device.spawn(cmd, {
      env: {
        PYTHONPATH: sidecarDir,
        // -u + PYTHONUNBUFFERED double-belt for early-startup log lines.
        PYTHONUNBUFFERED: '1',
      },
    });

    const sidecar = new Sidecar(proc, options.requestTimeoutMs ?? 15_000);

    // Wire stdout (responses) and stderr (logs / startup errors).
    sidecar.rl = createInterface({ input: proc.child.stdout, terminal: false });
    sidecar.rl.on('line', (line) => sidecar.handleResponseLine(line));
    sidecar.rlErr = createInterface({ input: proc.child.stderr, terminal: false });
    sidecar.rlErr.on('line', (line) => sidecar.captureStderr(line));

    proc.child.once('exit', (code) => {
      sidecar.handleExit(code);
    });

    // Probe startup with a status call. Fail fast if the binding is broken.
    try {
      const startupTimeout = options.startupTimeoutMs ?? 5_000;
      await sidecar.callWithTimeout('status', {}, startupTimeout);
    } catch (err) {
      proc.kill('SIGTERM');
      if (err instanceof SidecarRpcError) {
        throw new SidecarStartupError(err.message, sidecar.stderrTail);
      }
      if (err instanceof SidecarCrashedError) {
        throw new SidecarStartupError(
          `sidecar died during startup: ${err.message}`,
          sidecar.stderrTail,
        );
      }
      throw new SidecarStartupError(
        `sidecar status probe failed: ${(err as Error).message}`,
        sidecar.stderrTail,
      );
    }
    return sidecar;
  }

  isAlive(): boolean {
    return this.alive;
  }

  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.callWithTimeout(method, params, this.requestTimeoutMs);
  }

  private callWithTimeout(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (!this.alive) {
      return Promise.reject(new SidecarCrashedError(this.stderrTail, null));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[${method}] sidecar request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      const stdin = this.proc.child.stdin;
      if (!stdin || !stdin.writable) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new SidecarCrashedError(this.stderrTail, null));
        return;
      }
      stdin.write(`${payload}\n`, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private handleResponseLine(line: string): void {
    if (!line) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this.captureStderr(`[non-json on stdout]: ${line}`);
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const obj = msg as { id?: number; result?: unknown; error?: RpcError };
    if (typeof obj.id !== 'number') return;
    const pending = this.pending.get(obj.id);
    if (!pending) return;
    this.pending.delete(obj.id);
    clearTimeout(pending.timer);
    if (obj.error) {
      pending.reject(new SidecarRpcError(obj.error, pending.method));
    } else {
      pending.resolve(obj.result);
    }
  }

  private captureStderr(line: string): void {
    this.stderrTail += `${line}\n`;
    // Bound the tail to keep memory predictable on noisy sessions.
    if (this.stderrTail.length > 16_384) {
      this.stderrTail = this.stderrTail.slice(-8_192);
    }
  }

  private handleExit(code: number | null): void {
    this.alive = false;
    const err = new SidecarCrashedError(this.stderrTail, code);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }

  async dispose(): Promise<void> {
    if (!this.alive) return;
    this.proc.kill('SIGTERM');
    await this.proc.waitForExit().catch(() => undefined);
  }
}

export class SidecarRegistry {
  private readonly entries = new Map<string, Promise<Sidecar>>();

  constructor(private readonly options: SidecarOptions = {}) {}

  async get(device: Device): Promise<Sidecar> {
    let existing = this.entries.get(device.id);
    if (existing) {
      const sidecar = await existing;
      if (sidecar.isAlive()) return sidecar;
      this.entries.delete(device.id);
      existing = undefined;
    }
    const created = Sidecar.start(device, this.options);
    this.entries.set(device.id, created);
    // If startup throws, drop the cached promise so the next attempt retries.
    created.catch(() => {
      const current = this.entries.get(device.id);
      if (current === created) this.entries.delete(device.id);
    });
    return created;
  }

  async disposeAll(): Promise<void> {
    const all = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.allSettled(
      all.map(async (p) => {
        const s = await p.catch(() => null);
        if (s) await s.dispose();
      }),
    );
  }
}

export { Sidecar };
