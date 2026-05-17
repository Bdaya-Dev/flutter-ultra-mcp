// Tiny stderr JSON-lines logger.
//
// We mirror the shape the future shared @flutter-ultra/mcp-runtime
// `createLogger` will expose (see plan §17), so the eventual swap is a
// pure import-source change. Kept self-contained for now to avoid
// blocking on the shared package's wave-2 buildout (worker assigned to
// mcp-runtime hasn't fleshed it out yet).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  server: string;
  minLevel?: LogLevel;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(opts: LoggerOptions): Logger {
  const minLevel = opts.minLevel ?? 'info';
  const threshold = LEVEL_ORDER[minLevel];
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      server: opts.server,
      msg,
      ...(fields ?? {}),
    });
    process.stderr.write(line + '\n');
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
