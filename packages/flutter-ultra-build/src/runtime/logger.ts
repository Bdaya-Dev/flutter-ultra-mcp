/**
 * Stderr-only JSON-lines logger (plan §16.6).
 *
 * Stdout is reserved for JSON-RPC framing; any extra write corrupts the MCP
 * channel. We log to stderr in `{ts, level, server, msg, ...}` shape so the
 * host's MCP debug pane can parse it.
 */

import { SERVER_NAME } from '../constants.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envLevel(): LogLevel {
  const raw = (process.env['FLUTTER_ULTRA_LOG_LEVEL'] ?? 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

let active: LogLevel = envLevel();

export function setLogLevel(level: LogLevel): void {
  active = level;
}

function write(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (levelRank[level] < levelRank[active]) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    server: SERVER_NAME,
    msg,
    ...(fields ?? {}),
  };
  console.error(JSON.stringify(record));
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
