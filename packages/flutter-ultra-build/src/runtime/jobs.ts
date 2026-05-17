/**
 * Marathon split-tool job manager (plan §17.5).
 *
 * Every long-running job (build_runner build, builds, pub_upgrade_major,
 * tests, firebase distribute) goes through this. The pattern:
 *
 *   start_*  → spawns detached child, writes initial job record, returns jobId
 *   poll_*   → reads job record, returns {status, progress, partial_output}
 *   get_*    → reads finished job record, returns full result (errors if running)
 *   cancel_* → sets cancelled flag, kills child
 *
 * State persists at `${CLAUDE_PLUGIN_DATA}/state/jobs/<jobId>.json` so jobs
 * survive MCP server restarts (AC-T4). Stdout is appended to a sibling
 * `<jobId>.stdout.log` file with a configurable tail-byte limit.
 */

import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { nanoid } from 'nanoid';
import { log } from './logger.js';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobProgress {
  fraction?: number;
  stage?: string;
  message?: string;
  filesProcessed?: number;
  totalFiles?: number;
}

export interface JobRecord {
  jobId: string;
  jobType: string;
  cmd: string;
  args: string[];
  cwd: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  pid?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  progress: JobProgress;
  /** True when caller invoked cancel; worker should self-terminate. */
  cancelRequested: boolean;
  /** Final stderr captured (capped). */
  stderrTail?: string;
  /** Final stdout-tail captured for diagnostics. Truncated by log file. */
  stdoutTailBytes?: number;
  /** Extra structured result published by progress parser. */
  result?: Record<string, unknown>;
  /** Error message if the job manager itself failed (separate from exit code). */
  error?: string;
}

const STDOUT_LOG_MAX = 4 * 1024 * 1024;
const STDERR_BUFFER_MAX = 256 * 1024;

function pluginDataRoot(): string {
  const env = process.env['CLAUDE_PLUGIN_DATA'];
  if (env && env.length > 0) return env;
  // Fallback: ~/.flutter-ultra-mcp/data
  return join(homedir(), '.flutter-ultra-mcp', 'data');
}

export function jobsDir(): string {
  return join(pluginDataRoot(), 'state', 'jobs');
}

function jobPath(jobId: string): string {
  return join(jobsDir(), `${jobId}.json`);
}

function jobStdoutPath(jobId: string): string {
  return join(jobsDir(), `${jobId}.stdout.log`);
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function writeRecord(rec: JobRecord): void {
  ensureDir(dirname(jobPath(rec.jobId)));
  writeFileSync(jobPath(rec.jobId), JSON.stringify(rec, null, 2), 'utf8');
}

function readRecord(jobId: string): JobRecord | undefined {
  const p = jobPath(jobId);
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, 'utf8')) as JobRecord;
}

function appendStdoutLog(jobId: string, chunk: Buffer): number {
  const path = jobStdoutPath(jobId);
  ensureDir(dirname(path));
  // Soft-cap by truncating from the front when size grows: cheap implementation
  // is "rotate when size > STDOUT_LOG_MAX": rename old to .old (overwrite) and
  // start fresh. The agent should poll often enough that they don't lose the
  // tail; tail bytes are surfaced in the job record.
  let curSize = 0;
  try {
    curSize = statSync(path).size;
  } catch {
    // missing
  }
  if (curSize + chunk.length > STDOUT_LOG_MAX) {
    // Rotate.
    try {
      writeFileSync(path + '.old', readFileSync(path));
    } catch {
      // ignore
    }
    writeFileSync(path, chunk);
    return chunk.length;
  }
  const fd = openSync(path, 'a');
  writeSync(fd, chunk);
  closeSync(fd);
  return curSize + chunk.length;
}

/**
 * Progress parser: matches lines emitted by `dart`/`flutter` and updates the
 * record's progress field. Specific subcommands register their own regexes.
 */
export interface ProgressParser {
  parse(line: string): JobProgress | undefined;
}

export interface StartJobOptions {
  jobType: string;
  cmd: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Optional parser for live progress updates. */
  progressParser?: ProgressParser;
  /** Optional initial progress block (e.g., stage="queued"). */
  initialProgress?: JobProgress;
}

export interface StartedJob {
  jobId: string;
  record: JobRecord;
}

const inflightChildren = new Map<string, { kill: (sig: NodeJS.Signals) => void }>();
const inflightStderr = new Map<string, Buffer[]>();
const inflightStderrSize = new Map<string, number>();

export function startJob(opts: StartJobOptions): StartedJob {
  const jobId = `job_${nanoid(10)}`;
  ensureDir(jobsDir());

  const record: JobRecord = {
    jobId,
    jobType: opts.jobType,
    cmd: opts.cmd,
    args: opts.args,
    cwd: opts.cwd,
    status: 'pending',
    startedAt: Date.now(),
    progress: opts.initialProgress ?? {},
    cancelRequested: false,
  };
  writeRecord(record);

  const child = spawn(opts.cmd, opts.args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    detached: false, // managed within this process; cleanup on server exit
  });

  if (child.pid !== undefined) record.pid = child.pid;
  record.status = 'running';
  writeRecord(record);

  inflightChildren.set(jobId, { kill: (sig) => child.kill(sig) });
  inflightStderr.set(jobId, []);
  inflightStderrSize.set(jobId, 0);

  // Stdout pipeline
  let stdoutCarry = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    record.stdoutTailBytes = appendStdoutLog(jobId, chunk);
    if (opts.progressParser) {
      const lines = (stdoutCarry + chunk.toString('utf8')).split(/\r?\n/);
      stdoutCarry = lines.pop() ?? '';
      let changed = false;
      for (const line of lines) {
        const upd = opts.progressParser.parse(line);
        if (upd) {
          Object.assign(record.progress, upd);
          changed = true;
        }
      }
      if (changed) writeRecord(record);
    }
  });

  // Stderr capture (capped)
  child.stderr?.on('data', (chunk: Buffer) => {
    const buf = inflightStderr.get(jobId);
    const sz = inflightStderrSize.get(jobId) ?? 0;
    if (!buf) return;
    if (sz + chunk.length <= STDERR_BUFFER_MAX) {
      buf.push(chunk);
      inflightStderrSize.set(jobId, sz + chunk.length);
    } else if (sz < STDERR_BUFFER_MAX) {
      const remaining = STDERR_BUFFER_MAX - sz;
      buf.push(chunk.subarray(0, remaining));
      inflightStderrSize.set(jobId, STDERR_BUFFER_MAX);
    }
  });

  child.on('error', (err) => {
    record.status = 'failed';
    record.error = err instanceof Error ? err.message : String(err);
    record.finishedAt = Date.now();
    writeRecord(record);
    inflightChildren.delete(jobId);
    inflightStderr.delete(jobId);
    inflightStderrSize.delete(jobId);
    log.error('job spawn errored', { jobId, error: record.error });
  });

  child.on('close', (code, signal) => {
    const stderr = Buffer.concat(inflightStderr.get(jobId) ?? []).toString('utf8');
    record.exitCode = code;
    record.signal = signal;
    record.stderrTail = stderr;
    record.finishedAt = Date.now();
    if (record.cancelRequested) record.status = 'cancelled';
    else if (code === 0) record.status = 'completed';
    else record.status = 'failed';
    writeRecord(record);
    inflightChildren.delete(jobId);
    inflightStderr.delete(jobId);
    inflightStderrSize.delete(jobId);
    log.info('job finished', {
      jobId,
      jobType: opts.jobType,
      status: record.status,
      exitCode: code,
      durationMs: record.finishedAt - record.startedAt,
    });
  });

  log.info('job started', { jobId, jobType: opts.jobType, pid: child.pid });
  return { jobId, record };
}

export function readJob(jobId: string): JobRecord | undefined {
  return readRecord(jobId);
}

export function cancelJob(jobId: string): JobRecord | undefined {
  const rec = readRecord(jobId);
  if (!rec) return undefined;
  if (rec.status !== 'running' && rec.status !== 'pending') return rec;
  rec.cancelRequested = true;
  writeRecord(rec);
  const handle = inflightChildren.get(jobId);
  if (handle) {
    try {
      handle.kill('SIGTERM');
      setTimeout(() => handle.kill('SIGKILL'), 2000).unref();
    } catch {
      // already dead
    }
  }
  return rec;
}

/** Read the captured stdout tail (last N bytes). Empty if none. */
export function readStdoutTail(jobId: string, maxBytes = 64 * 1024): string {
  const p = jobStdoutPath(jobId);
  if (!existsSync(p)) return '';
  const sz = statSync(p).size;
  if (sz <= maxBytes) return readFileSync(p, 'utf8');
  const buf = Buffer.alloc(maxBytes);
  const fd = openSync(p, 'r');
  try {
    const bytesRead = readSync(fd, buf, 0, maxBytes, sz - maxBytes);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** List all known jobs (for debugging / introspection). */
export function listJobs(): JobRecord[] {
  const dir = jobsDir();
  if (!existsSync(dir)) return [];
  const out: JobRecord[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = readFileSync(join(dir, file), 'utf8');
      out.push(JSON.parse(raw) as JobRecord);
    } catch {
      // skip corrupt records
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** Kill all in-process jobs on server shutdown. */
export function shutdownAllJobs(): void {
  for (const [jobId, handle] of inflightChildren.entries()) {
    try {
      handle.kill('SIGTERM');
    } catch {
      // ignore
    }
    log.info('shutdown: killed in-flight job', { jobId });
  }
}
