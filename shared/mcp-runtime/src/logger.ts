// JSON-lines structured logger writing to stderr.
//
// Plan §16 conventions: every log line is a single JSON object with
// {ts, level, server, msg, ...fields}. Stderr keeps stdout free for the
// MCP JSON-RPC stream.

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
}

export function createLogger(opts: LoggerOptions): Logger {
  const minLevel = resolveMinLevel(opts);
  return makeLogger(opts.server, minLevel, {});
}

function makeLogger(
  server: string,
  minLevel: LogLevel,
  baseFields: Record<string, unknown>,
): Logger {
  const threshold = LEVEL_ORDER[minLevel];
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      server,
      msg,
      ...baseFields,
      ...(fields ?? {}),
    });
    process.stderr.write(line + '\n');
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) => makeLogger(server, minLevel, { ...baseFields, ...extra }),
  };
}
