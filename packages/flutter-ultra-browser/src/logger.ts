// Structured JSON-line stderr logger per plan §16.6.
// NEVER writes to stdout — that channel is owned by the MCP stdio transport.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (process.env.FLUTTER_ULTRA_LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
const minRank = LEVEL_RANK[envLevel] ?? LEVEL_RANK.info;

function emit(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < minRank) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    server: 'flutter-ultra-browser',
    msg,
    ...extra,
  });
  // stderr only — stdout is reserved for JSON-RPC framing.
  process.stderr.write(line + '\n');
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
};
