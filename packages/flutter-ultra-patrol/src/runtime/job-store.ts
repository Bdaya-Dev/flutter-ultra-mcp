// Marathon-tool job table.
//
// Plan §17.2 split-tool pattern: long-running ops (start_patrol_test,
// start_patrol_develop) MUST return immediately with a taskId; the agent
// polls via poll_patrol_job and finalizes via get_patrol_result. Job state
// lives in-memory per server process — losing it on restart is acceptable
// because the caller can re-issue, and on-disk would complicate cleanup
// of orphaned child processes.

import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';

export type JobKind = 'test' | 'develop';

export type JobStatus =
  | 'pending' // spawned, no output yet
  | 'running' // first stdout/stderr line received
  | 'completed' // child exited with code 0
  | 'failed' // child exited with non-zero code
  | 'cancelled' // explicitly cancelled by cancel_patrol_job
  | 'crashed'; // ChildProcess emitted 'error'

export interface JobLogLine {
  ts: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface PatrolJobRecord {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** Resolved spawn command for diagnostics. */
  command: string;
  args: string[];
  /** Absolute project root the job runs in. */
  cwd: string;
  /** Wrapper-script path if one was detected; null for dart-run. */
  wrapperScript: string | null;
  /** Env vars merged onto child process env. */
  envSnapshot: Record<string, string>;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms; only set once status moves to a terminal state. */
  endedAt: number | null;
  /** OS exit code. -1 means killed before exit. null while still running. */
  exitCode: number | null;
  /** Last child error message if status=crashed. */
  errorMessage: string | null;
  /** Bounded rolling log buffer — keeps memory bounded. */
  logTail: JobLogLine[];
  /** Total log lines observed, including those dropped from the tail. */
  logTotal: number;
  /** Underlying child process; null after exit / cancel. */
  child: ChildProcess | null;
}

const DEFAULT_LOG_TAIL_LIMIT = 500;

export interface JobStoreOptions {
  /** Per-job log line ring buffer size. */
  logTailLimit?: number;
}

export class JobStore {
  private readonly jobs = new Map<string, PatrolJobRecord>();
  private readonly logTailLimit: number;

  constructor(opts: JobStoreOptions = {}) {
    this.logTailLimit = opts.logTailLimit ?? DEFAULT_LOG_TAIL_LIMIT;
  }

  /**
   * Allocate a job record and wire stdout/stderr/exit listeners. The
   * caller must call {@link create} *after* spawning the child so the PID
   * is available, then call {@link attachChild} once the ChildProcess is
   * ready to receive listeners.
   */
  create(input: {
    kind: JobKind;
    command: string;
    args: string[];
    cwd: string;
    wrapperScript: string | null;
    envSnapshot: Record<string, string>;
  }): PatrolJobRecord {
    const record: PatrolJobRecord = {
      id: randomUUID(),
      kind: input.kind,
      status: 'pending',
      command: input.command,
      args: input.args.slice(),
      cwd: input.cwd,
      wrapperScript: input.wrapperScript,
      envSnapshot: { ...input.envSnapshot },
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      errorMessage: null,
      logTail: [],
      logTotal: 0,
      child: null,
    };
    this.jobs.set(record.id, record);
    return record;
  }

  attachChild(id: string, child: ChildProcess): void {
    const rec = this.jobs.get(id);
    if (!rec) throw new Error(`JobStore.attachChild: no job ${id}`);
    rec.child = child;
    rec.status = 'running';

    const pushLog = (stream: 'stdout' | 'stderr', text: string): void => {
      rec.logTotal += 1;
      rec.logTail.push({ ts: Date.now(), stream, text });
      if (rec.logTail.length > this.logTailLimit) {
        rec.logTail.shift();
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.length > 0) pushLog('stdout', line);
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.length > 0) pushLog('stderr', line);
      }
    });
    child.on('exit', (code, signal) => {
      rec.endedAt = Date.now();
      rec.child = null;
      if (rec.status === 'cancelled') {
        rec.exitCode = code ?? -1;
        return;
      }
      rec.exitCode = code ?? (signal != null ? -1 : 0);
      rec.status = code === 0 ? 'completed' : 'failed';
    });
    child.on('error', (err) => {
      rec.endedAt = Date.now();
      rec.exitCode = -1;
      rec.status = 'crashed';
      rec.errorMessage = err.message;
      rec.child = null;
    });
  }

  get(id: string): PatrolJobRecord | undefined {
    return this.jobs.get(id);
  }

  list(): PatrolJobRecord[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Send SIGTERM, then SIGKILL after gracePeriodMs. Returns true if a
   * child was found and signalled, false if the job is already terminal.
   */
  cancel(id: string, gracePeriodMs = 2_000): boolean {
    const rec = this.jobs.get(id);
    if (!rec) return false;
    if (rec.child == null) return false;
    rec.status = 'cancelled';
    const child = rec.child;
    try {
      child.kill('SIGTERM');
    } catch {
      // Already exited; the exit listener will finalize.
      return false;
    }
    setTimeout(() => {
      if (rec.child === child && !child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* swallow */
        }
      }
    }, gracePeriodMs).unref();
    return true;
  }

  /** Drop jobs older than the cutoff (ms-epoch) — call periodically. */
  prune(cutoffMs: number): number {
    let dropped = 0;
    for (const [id, rec] of this.jobs.entries()) {
      if (rec.endedAt !== null && rec.endedAt < cutoffMs) {
        this.jobs.delete(id);
        dropped += 1;
      }
    }
    return dropped;
  }
}
