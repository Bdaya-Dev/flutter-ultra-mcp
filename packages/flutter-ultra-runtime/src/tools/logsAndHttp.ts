// Logging + runtime errors + HTTP capture tools.

import { z } from 'zod';
import {
  InvalidToolInputError,
  SessionIdSchema,
  type FlutterUltraServer,
} from '@flutter-ultra/mcp-runtime';
import type { VmServiceClient } from '@flutter-ultra/vm-service-client';
import { createLogBuffer, type LogBuffer } from '../logBuffer.js';
import type { SessionRegistry } from '../sessions.js';
import type { HttpCaptureService } from '../httpCapture.js';

interface BufferEntry {
  buffer: LogBuffer;
  release: () => Promise<void>;
}

export function registerLogsAndHttpTools(opts: {
  server: FlutterUltraServer;
  sessions: SessionRegistry;
  http: HttpCaptureService;
}): void {
  const { server, sessions, http } = opts;
  const buffers = new Map<string, BufferEntry>();

  async function getOrCreateBuffer(sessionId: string): Promise<BufferEntry> {
    const existing = buffers.get(sessionId);
    if (existing) return existing;
    const { client, release } = await sessions.acquireClient(sessionId);
    const buffer = createLogBuffer({
      sessionId,
      client,
      streamId: `logs-${sessionId}`,
      logger: server.logger,
    });
    await buffer.attach();
    const entry: BufferEntry = {
      buffer,
      release: async () => {
        buffer.detach();
        await release();
      },
    };
    buffers.set(sessionId, entry);
    return entry;
  }

  async function resolveIsolate(sessionId: string): Promise<{
    isolateId: string;
    client: VmServiceClient;
    release: () => Promise<void>;
  }> {
    const { client, release } = await sessions.acquireClient(sessionId);
    try {
      const vm = await client.getVM();
      const isolateId = vm.isolates[0]?.id;
      if (!isolateId) {
        await release();
        throw new InvalidToolInputError('Session has no isolates.');
      }
      return { isolateId, client, release };
    } catch (err) {
      await release();
      throw err;
    }
  }

  server.defineTool(
    {
      name: 'get_logs',
      description:
        'Replay the in-memory log buffer (DDS getStreamHistory + live tail). Use `tail_logs` (split-tool) for ongoing streaming.',
      inputShape: {
        sessionId: SessionIdSchema,
        afterCursor: z.number().int().nonnegative().default(0),
        maxEntries: z.number().int().positive().default(500),
        levelFilter: z.enum(['debug', 'info', 'warn', 'error', 'all']).default('all'),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const entry = await getOrCreateBuffer(args.sessionId);
      const { entries, cursor } = entry.buffer.entriesSince(args.afterCursor);
      const slice = entries.slice(0, args.maxEntries);
      return {
        entries: slice,
        cursor,
        returned: slice.length,
        totalSinceStart: cursor,
      };
    },
  );

  server.defineTool(
    {
      name: 'start_tail_logs',
      description:
        'Begin a continuous log tail. Returns {streamId, cursor}. Call `poll_tail_logs` with the cursor to get new entries since.',
      inputShape: { sessionId: SessionIdSchema },
      timeoutClass: 'quick',
    },
    async (args) => {
      await getOrCreateBuffer(args.sessionId);
      const streamId = `logs-${args.sessionId}`;
      return { streamId, cursor: 0 };
    },
  );

  server.defineTool(
    {
      name: 'poll_tail_logs',
      description:
        'Return new log entries since the given cursor. Returns the next cursor for the following poll.',
      inputShape: {
        sessionId: SessionIdSchema,
        afterCursor: z.number().int().nonnegative(),
        maxEntries: z.number().int().positive().default(500),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const entry = await getOrCreateBuffer(args.sessionId);
      const { entries, cursor } = entry.buffer.entriesSince(args.afterCursor);
      const slice = entries.slice(0, args.maxEntries);
      return { entries: slice, cursor, returned: slice.length };
    },
  );

  server.defineTool(
    {
      name: 'stop_tail_logs',
      description:
        'Stop the in-memory log tail for the session (releases the streamListen handle).',
      inputShape: { sessionId: SessionIdSchema },
      timeoutClass: 'quick',
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const entry = buffers.get(args.sessionId);
      if (entry) {
        await entry.release();
        buffers.delete(args.sessionId);
      }
      return { ok: true };
    },
  );

  server.defineTool(
    {
      name: 'get_runtime_errors',
      description:
        'Recent uncaught exceptions from the Flutter framework. Reads from the Extension stream log buffer filtering on Flutter.Error.',
      inputShape: {
        sessionId: SessionIdSchema,
        afterCursor: z.number().int().nonnegative().default(0),
        maxEntries: z.number().int().positive().default(50),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const entry = await getOrCreateBuffer(args.sessionId);
      const { entries, cursor } = entry.buffer.entriesSince(args.afterCursor);
      const errors = entries.filter(
        (e) =>
          e.stream === 'Extension' &&
          (e.extensionKind === 'Flutter.Error' || e.extensionKind === 'Flutter.Assertion'),
      );
      return { errors: errors.slice(0, args.maxEntries), cursor };
    },
  );

  server.defineTool(
    {
      name: 'start_http_capture',
      description:
        'Begin recording HTTP / gRPC traffic for the session via ext.dart.io.getHttpProfile. Returns captureId; pass to `get_http_events` / `stop_http_capture`.',
      inputShape: { sessionId: SessionIdSchema },
      timeoutClass: 'quick',
      ceilingMs: 15_000,
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const result = await http.start({ sessionId: args.sessionId, client, isolateId });
        return result;
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'get_http_events',
      description:
        'Fetch cumulative HTTP events for a capture. Bodies are base64 so binary gRPC payloads survive JSON.',
      inputShape: {
        sessionId: SessionIdSchema,
        captureId: z.string().min(8),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { client, release } = await sessions.acquireClient(args.sessionId);
      try {
        const events = await http.events(args.captureId, client);
        return { events, count: events.length };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'stop_http_capture',
      description: 'Stop a capture; returns the final event list and releases the resource.',
      inputShape: {
        sessionId: SessionIdSchema,
        captureId: z.string().min(8),
      },
      timeoutClass: 'quick',
      ceilingMs: 15_000,
      annotations: { destructiveHint: false },
    },
    async (args) => {
      const { client, release } = await sessions.acquireClient(args.sessionId);
      try {
        const events = await http.stop(args.captureId, client);
        return { events, count: events.length, final: true };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'decode_grpc_message',
      description:
        'Decode a base64 gRPC payload into JSON using a .proto file (or a protobufjs JSON descriptor). Handles the 5-byte gRPC frame header automatically.',
      inputShape: {
        bodyB64: z.string().min(1),
        protoPath: z
          .string()
          .min(1)
          .describe('Absolute path to a .proto file OR a protobufjs JSON descriptor file (.json).'),
        messageType: z
          .string()
          .min(1)
          .describe('Fully-qualified message name, e.g. invora.invoicing.v2.ListInvoicesResponse.'),
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const decoded = await http.decode({
        bodyB64: args.bodyB64,
        protoPath: args.protoPath,
        messageType: args.messageType,
      });
      return { decoded };
    },
  );

  // Expose the in-memory buffer count for diagnostics — useful for the
  // CI test that asserts the tool catalogue stays in sync (AC-T1).
  server.defineTool(
    {
      name: 'log_buffer_stats',
      description:
        'Return per-session in-memory buffer counts. Useful for debugging streamListen plumbing.',
      timeoutClass: 'instant',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const out: Array<{ sessionId: string; entries: number }> = [];
      for (const [sessionId, entry] of buffers) {
        out.push({ sessionId, entries: entry.buffer.entries().length });
      }
      return { buffers: out };
    },
  );
}
