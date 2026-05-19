// Marathon-tool job table.
//
// Plan §17.2 split-tool pattern: long-running ops (start_patrol_test,
// start_patrol_develop) MUST return immediately with a taskId; the agent
// polls via poll_patrol_job and finalizes via get_patrol_result. Job state
// persisted to {stateDir}/jobs/{id}.json so results survive server restarts.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

/** Subset of PatrolJobRecord that is persisted to disk. */
interface PersistedJobRecord {
  id: string;
  kind: JobKind;
  status: JobStatus;
  command: string;
  args: string[];
  cwd: string;
  wrapperScript: string | null;
  envSnapshot: Record<string, string>;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  errorMessage: string | null;
}

const TERMINAL_STATUSES = new Set<JobStatus>(['completed', 'failed', 'cancelled', 'crashed']);

const DEFAULT_LOG_TAIL_LIMIT = 500;

export interface JobStoreOptions {
  /** Per-job log line ring buffer size. */
  logTailLimit?: number;
  /** Directory under which jobs/{id}.json are written. Omit to disable persistence. */
  stateDir?: string;
}

export class JobStore {
  private readonly jobs = new Map<string, PatrolJobRecord>();
  private readonly logTailLimit: number;
  private readonly stateDir: string | undefined;

  constructor(opts: JobStoreOptions = {}) {
    this.logTailLimit = opts.logTailLimit ?? DEFAULT_LOG_TAIL_LIMIT;
    this.stateDir = opts.stateDir;
  }

  private jobsDir(): string {
    return join(this.stateDir!, 'jobs');
  }

  private jobFilePath(id: string): string {
    return join(this.jobsDir(), `${id}.json`);
  }

  private async persistJob(rec: PatrolJobRecord): Promise<void> {
    if (!this.stateDir) return;
    const dir = this.jobsDir();
    await mkdir(dir, { recursive: true });
    const persisted: PersistedJobRecord = {
      id: rec.id,
      kind: rec.kind,
      status: rec.status,
      command: rec.command,
      args: rec.args,
      cwd: rec.cwd,
      wrapperScript: rec.wrapperScript,
      envSnapshot: rec.envSnapshot,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      exitCode: rec.exitCode,
      errorMessage: rec.errorMessage,
    };
    const path = this.jobFilePath(rec.id);
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(persisted, null, 2), 'utf8');
    await rename(tmp, path);
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
    // Fire-and-forget; write errors are non-fatal.
    void this.persistJob(record).catch(() => undefined);
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
        void this.persistJob(rec).catch(() => undefined);
        return;
      }
      rec.exitCode = code ?? (signal != null ? -1 : 0);
      rec.status = code === 0 ? 'completed' : 'failed';
      void this.persistJob(rec).catch(() => undefined);
    });
    child.on('error', (err) => {
      rec.endedAt = Date.now();
      rec.exitCode = -1;
      rec.status = 'crashed';
      rec.errorMessage = err.message;
      rec.child = null;
      void this.persistJob(rec).catch(() => undefined);
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
        if (this.stateDir) {
          void rm(this.jobFilePath(id), { force: true }).catch(() => undefined);
        }
      }
    }
    return dropped;
  }

  /**
   * Scan {stateDir}/jobs/*.json and load persisted records into the in-memory
   * map. Non-terminal jobs are marked 'crashed' (the process is gone).
   * Call once at server startup before accepting requests.
   */
  async recover(): Promise<PatrolJobRecord[]> {
    if (!this.stateDir) return [];
    const dir = this.jobsDir();
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const recovered: PatrolJobRecord[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const path = join(dir, file);
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch {
        continue;
      }
      let persisted: PersistedJobRecord;
      try {
        persisted = JSON.parse(raw) as PersistedJobRecord;
      } catch {
        continue;
      }
      // Skip if already in memory (shouldn't happen on startup, but be safe).
      if (this.jobs.has(persisted.id)) continue;

      const wasRunning = !TERMINAL_STATUSES.has(persisted.status);
      const rec: PatrolJobRecord = {
        id: persisted.id,
        kind: persisted.kind,
        status: wasRunning ? 'crashed' : persisted.status,
        command: persisted.command,
        args: persisted.args,
        cwd: persisted.cwd,
        wrapperScript: persisted.wrapperScript,
        envSnapshot: persisted.envSnapshot,
        startedAt: persisted.startedAt,
        endedAt: wasRunning ? Date.now() : persisted.endedAt,
        exitCode: wasRunning ? -1 : persisted.exitCode,
        errorMessage: wasRunning
          ? 'Server restarted while job was running'
          : persisted.errorMessage,
        logTail: [],
        logTotal: 0,
        child: null,
      };
      this.jobs.set(rec.id, rec);
      // Persist the updated (crashed) status back to disk.
      if (wasRunning) {
        void this.persistJob(rec).catch(() => undefined);
      }
      recovered.push(rec);
    }
    return recovered;
  }
}
