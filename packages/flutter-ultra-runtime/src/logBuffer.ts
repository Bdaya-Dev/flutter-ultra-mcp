// In-memory log buffer for `get_logs` / `tail_logs` (split-tool).
//
// Subscribes to Logging / Stdout / Stderr / Extension streams on a session's
// VmServiceClient, keeps the last LOG_BUFFER_MAX events in memory plus appends
// to a JSONL stream file so `start_tail_logs` / `poll_tail_logs` work across
// server restarts.

import type { Event, VmServiceClient } from '@flutter-ultra/vm-service-client';
import type { Logger } from '@flutter-ultra/mcp-runtime';
import { appendJsonl, streamFilePath } from '@flutter-ultra/state-store';

export interface LogEntry {
  ts: number;
  sessionId: string;
  stream: 'Logging' | 'Stdout' | 'Stderr' | 'Extension';
  level?: string;
  loggerName?: string;
  message?: string;
  error?: string;
  stackTrace?: string;
  extensionKind?: string;
  extensionData?: unknown;
  raw?: unknown;
}

const LOG_BUFFER_MAX = 10_000;

export interface LogBuffer {
  entries(): LogEntry[];
  entriesSince(cursor: number): { entries: LogEntry[]; cursor: number };
  attach(): Promise<void>;
  detach(): void;
}

export function createLogBuffer(opts: {
  sessionId: string;
  client: VmServiceClient;
  streamId: string; // for the JSONL file on disk
  logger: Logger;
}): LogBuffer {
  const ring: LogEntry[] = [];
  const log = opts.logger.child({ component: 'logBuffer', sessionId: opts.sessionId });
  let attached = false;

  const handlers: Array<{ name: keyof VmEventChannels; fn: (e: Event) => void }> = [];

  function record(entry: LogEntry): void {
    ring.push(entry);
    if (ring.length > LOG_BUFFER_MAX) ring.splice(0, ring.length - LOG_BUFFER_MAX);
    // Fire-and-forget JSONL append; do not await so the event handler
    // returns quickly.
    appendJsonl(streamFilePath(opts.streamId), entry, { maxLines: LOG_BUFFER_MAX }).catch((err) => {
      log.debug('jsonl append failed', { err: String(err) });
    });
  }

  function fromLogging(event: Event): LogEntry {
    const r = event.logRecord as Record<string, unknown> | undefined;
    const result: LogEntry = {
      ts: event.timestamp,
      sessionId: opts.sessionId,
      stream: 'Logging',
      raw: event.logRecord,
    };
    if (r) {
      const message = pickInstanceText(r['message']);
      const loggerName = pickInstanceText(r['loggerName']);
      const error = pickInstanceText(r['error']);
      const stackTrace = pickInstanceText(r['stackTrace']);
      const level = typeof r['level'] === 'number' ? String(r['level']) : undefined;
      if (message !== undefined) result.message = message;
      if (loggerName !== undefined) result.loggerName = loggerName;
      if (error !== undefined) result.error = error;
      if (stackTrace !== undefined) result.stackTrace = stackTrace;
      if (level !== undefined) result.level = level;
    }
    return result;
  }

  function fromStdout(event: Event, stream: 'Stdout' | 'Stderr'): LogEntry {
    const result: LogEntry = {
      ts: event.timestamp,
      sessionId: opts.sessionId,
      stream,
    };
    if (typeof event.bytes === 'string') {
      try {
        result.message = Buffer.from(event.bytes, 'base64').toString('utf8');
      } catch {
        result.message = event.bytes;
      }
    }
    return result;
  }

  function fromExtension(event: Event): LogEntry {
    const result: LogEntry = {
      ts: event.timestamp,
      sessionId: opts.sessionId,
      stream: 'Extension',
    };
    if (event.extensionKind !== undefined) result.extensionKind = event.extensionKind;
    if (event.extensionData !== undefined) result.extensionData = event.extensionData;
    return result;
  }

  async function attach(): Promise<void> {
    if (attached) return;
    attached = true;

    // Replay recent history.
    for (const streamId of ['Logging', 'Stdout', 'Stderr', 'Extension'] as const) {
      try {
        const history = await opts.client.getStreamHistory(streamId);
        for (const event of history.history) {
          if (streamId === 'Logging') record(fromLogging(event));
          else if (streamId === 'Stdout') record(fromStdout(event, 'Stdout'));
          else if (streamId === 'Stderr') record(fromStdout(event, 'Stderr'));
          else if (streamId === 'Extension') record(fromExtension(event));
        }
      } catch (err) {
        log.debug('getStreamHistory failed', { streamId, err: String(err) });
      }
    }

    const onLogging = (event: Event): void => record(fromLogging(event));
    const onStdout = (event: Event): void => record(fromStdout(event, 'Stdout'));
    const onStderr = (event: Event): void => record(fromStdout(event, 'Stderr'));
    const onExtension = (event: Event): void => record(fromExtension(event));

    opts.client.on('loggingEvent', onLogging);
    opts.client.on('stdoutEvent', onStdout);
    opts.client.on('stderrEvent', onStderr);
    opts.client.on('extensionEvent', onExtension);

    handlers.push({ name: 'loggingEvent', fn: onLogging });
    handlers.push({ name: 'stdoutEvent', fn: onStdout });
    handlers.push({ name: 'stderrEvent', fn: onStderr });
    handlers.push({ name: 'extensionEvent', fn: onExtension });
  }

  function detach(): void {
    for (const h of handlers) {
      opts.client.off(h.name, h.fn);
    }
    handlers.length = 0;
    attached = false;
  }

  return {
    entries: () => [...ring],
    entriesSince(cursor: number) {
      const total = ring.length;
      const startIdx = Math.max(0, cursor);
      const slice = ring.slice(startIdx);
      return { entries: slice, cursor: total };
    },
    attach,
    detach,
  };
}

// Helper: VM Service Logging records carry @Instance refs whose value is
// in `valueAsString`. Extract the actual string for the agent.
function pickInstanceText(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) {
    const obj = v as Record<string, unknown>;
    const direct = obj['valueAsString'];
    if (typeof direct === 'string') return direct;
  }
  return undefined;
}

// Narrowing helper — keys of the typed event emitter we listen on.
type VmEventChannels = {
  loggingEvent: [Event];
  stdoutEvent: [Event];
  stderrEvent: [Event];
  extensionEvent: [Event];
};
