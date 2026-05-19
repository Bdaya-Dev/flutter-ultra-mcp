// JSON-lines structured logger writing to stderr.
//
// Plan §16 conventions: every log line is a single JSON object with
// {ts, level, server, msg, ...fields}. Stderr keeps stdout free for the
// MCP JSON-RPC stream.
//
// In-memory ring buffer: last N entries retained for diagnostics retrieval.
// Controlled by FLUTTER_ULTRA_LOG_MAX_ENTRIES (default 10000). When the
// buffer exceeds the cap the oldest entry is dropped (shift/push ring).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  server: string;
  // Default 'info'. Override via env FLUTTER_ULTRA_LOG_LEVEL.
  minLevel?: LogLevel;
  // Shared ring buffer. When omitted a new buffer is created.
  buffer?: LogBuffer;
}

export interface LogEntry {
  ts: string;
  level: LogLevel;
  server: string;
  msg: string;
  [key: string]: unknown;
}

// Bounded ring buffer shared across child loggers of the same server.
export class LogBuffer {
  private readonly entries: LogEntry[] = [];
  readonly maxEntries: number;

  constructor(maxEntries?: number) {
    this.maxEntries = maxEntries ?? resolveMaxEntries();
  }

  push(entry: LogEntry): void {
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
    }
    this.entries.push(entry);
  }

  snapshot(): ReadonlyArray<LogEntry> {
    return this.entries.slice();
  }

  get size(): number {
    return this.entries.length;
  }
}

function resolveMaxEntries(): number {
  const raw = process.env['FLUTTER_ULTRA_LOG_MAX_ENTRIES'];
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 10_000;
}

function resolveMinLevel(opts: LoggerOptions): LogLevel {
  const envLevel = process.env.FLUTTER_ULTRA_LOG_LEVEL as LogLevel | undefined;
  if (envLevel && envLevel in LEVEL_ORDER) return envLevel;
  return opts.minLevel ?? 'info';
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(extra: Record<string, unknown>): Logger;
  readonly buffer: LogBuffer;
}

export function createLogger(opts: LoggerOptions): Logger {
  const minLevel = resolveMinLevel(opts);
  const buffer = opts.buffer ?? new LogBuffer();
  return makeLogger(opts.server, minLevel, {}, buffer);
}

function makeLogger(
  server: string,
  minLevel: LogLevel,
  baseFields: Record<string, unknown>,
  buffer: LogBuffer,
): Logger {
  const threshold = LEVEL_ORDER[minLevel];
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      server,
      msg,
      ...baseFields,
      ...(fields ?? {}),
    };
    buffer.push(entry);
    process.stderr.write(JSON.stringify(entry) + '\n');
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) => makeLogger(server, minLevel, { ...baseFields, ...extra }, buffer),
    buffer,
  };
}
