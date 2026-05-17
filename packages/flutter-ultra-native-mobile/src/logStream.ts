// Device-logs streaming. Owns a long-running adb-logcat / xcrun simctl
// log child process per streamId, buffers the last N lines in memory, and
// exposes cursor-paginated reads — same shape as flutter-ultra-runtime's
// tail_logs split-tool trio so the agent's mental model is uniform.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { DeviceTransport } from './device.js';
import { AndroidDevice } from './android.js';
import { IosSimDevice } from './ios.js';

export interface LogLine {
  ts: number; // unix-ms
  raw: string;
}

export interface DeviceLogStream {
  streamId: string;
  deviceId: string;
  startedAt: number;
  bufferLines: number;
  lines: LogLine[];
  dropped: number;
  truncated: boolean;
  child: ChildProcess;
  grep?: RegExp;
}

export interface LogStreamService {
  start(opts: {
    device: DeviceTransport;
    tagFilters?: string[] | undefined;
    grep?: string | undefined;
    bufferLines?: number | undefined;
  }): Promise<DeviceLogStream>;
  poll(opts: { streamId: string; afterCursor: number; maxLines: number }): {
    cursor: number;
    lines: LogLine[];
    totalLines: number;
    dropped: number;
  };
  stop(streamId: string): void;
  has(streamId: string): boolean;
  shutdown(): void;
}

export function createLogStreamService(): LogStreamService {
  const streams = new Map<string, DeviceLogStream>();

  return {
    async start({ device, tagFilters, grep, bufferLines }) {
      const cap = bufferLines ?? 1_000;
      const streamId = randomUUID();
      let argv: string[];
      if (device instanceof AndroidDevice) {
        // logcat -v threadtime (deterministic timestamps) + filters.
        // Use a fresh `-c` clear? No — destructive; just attach to tail.
        argv = [device.adbCli, '-s', device.id, 'logcat', '-v', 'threadtime'];
        if (tagFilters && tagFilters.length > 0) {
          argv.push(...tagFilters);
        }
      } else if (device instanceof IosSimDevice) {
        // simctl spawn booted log stream — emits an unstructured tail.
        // We forward optional --predicate via `tagFilters` joined into one
        // predicate string, but to keep things simple we just stream raw.
        argv = ['xcrun', 'simctl', 'spawn', device.id, 'log', 'stream', '--style', 'compact'];
        if (tagFilters && tagFilters.length > 0) {
          argv.push('--predicate', tagFilters.join(' AND '));
        }
      } else {
        throw new Error(
          `device_logs: unsupported device kind '${device.kind}'. Android + iOS-sim supported.`,
        );
      }

      const child = spawn(argv[0]!, argv.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const stream: DeviceLogStream = {
        streamId,
        deviceId: device.id,
        startedAt: Date.now(),
        bufferLines: cap,
        lines: [],
        dropped: 0,
        truncated: false,
        child,
        ...(grep ? { grep: new RegExp(grep) } : {}),
      };

      let leftover = '';
      const consume = (chunk: Buffer): void => {
        const text = leftover + chunk.toString('utf8');
        const parts = text.split(/\r?\n/);
        leftover = parts.pop() ?? '';
        for (const line of parts) {
          if (!line) continue;
          if (stream.grep && !stream.grep.test(line)) continue;
          stream.lines.push({ ts: Date.now(), raw: line });
          if (stream.lines.length > stream.bufferLines) {
            stream.lines.shift();
            stream.dropped += 1;
            stream.truncated = true;
          }
        }
      };
      child.stdout?.on('data', consume);
      child.stderr?.on('data', consume);
      child.on('close', () => {
        // Process exits naturally when device disconnects or user stops.
      });

      streams.set(streamId, stream);
      return stream;
    },

    poll({ streamId, afterCursor, maxLines }) {
      const s = streams.get(streamId);
      if (!s) {
        throw new Error(`device_logs: stream '${streamId}' not found. Was it stopped?`);
      }
      const total = s.lines.length + s.dropped;
      // Cursor is absolute position in the (potentially truncated) stream.
      // If afterCursor < s.dropped we've lost those lines — bump to s.dropped.
      const effective = Math.max(afterCursor, s.dropped);
      const startIdx = effective - s.dropped;
      const sliceEnd = Math.min(s.lines.length, startIdx + maxLines);
      const lines = s.lines.slice(startIdx, sliceEnd);
      return {
        cursor: s.dropped + sliceEnd,
        lines,
        totalLines: total,
        dropped: s.dropped,
      };
    },

    stop(streamId) {
      const s = streams.get(streamId);
      if (!s) return;
      try {
        s.child.kill('SIGKILL');
      } catch {
        // already dead
      }
      streams.delete(streamId);
    },

    has(streamId) {
      return streams.has(streamId);
    },

    shutdown() {
      for (const s of streams.values()) {
        try {
          s.child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
      streams.clear();
    },
  };
}
