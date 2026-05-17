// HTTP / gRPC traffic capture for Flutter apps.
//
// Uses `ext.dart.io.getHttpProfile` (+ setHttpEnableTimelineLogging) — the
// Dart IO timeline records every HttpClient request from the isolate. We
// surface entries through a captureId so multiple captures across sessions
// don't collide.
//
// gRPC decoding (decode_grpc_message) uses protobufjs at runtime; agents
// pass the .proto path or a raw FileDescriptorSet.

import { randomUUID } from 'node:crypto';
import { readFile as readFileFs } from 'node:fs/promises';
import * as protobuf from 'protobufjs';
import { z } from 'zod';
import type { VmServiceClient } from '@flutter-ultra/vm-service-client';
import { InvalidToolInputError, type Logger } from '@flutter-ultra/mcp-runtime';

export const HttpEventSchema = z
  .object({
    id: z.string(),
    method: z.string(),
    uri: z.string(),
    requestHeaders: z.record(z.string()).optional(),
    requestBodyB64: z.string().optional(),
    responseHeaders: z.record(z.string()).optional(),
    responseBodyB64: z.string().optional(),
    statusCode: z.number().int().optional(),
    durationMs: z.number().optional(),
    startedAt: z.number().int(),
    endedAt: z.number().int().optional(),
    isGrpc: z.boolean(),
    grpcStatus: z.number().optional(),
    contentType: z.string().optional(),
  })
  .strict();
export type HttpEvent = z.infer<typeof HttpEventSchema>;

interface Capture {
  captureId: string;
  sessionId: string;
  isolateId: string;
  lastTimelineMicros: number;
  events: Map<string, HttpEvent>;
  startedAt: number;
}

export interface HttpCaptureService {
  start(opts: {
    sessionId: string;
    client: VmServiceClient;
    isolateId: string;
  }): Promise<{ captureId: string }>;
  events(captureId: string, client: VmServiceClient): Promise<HttpEvent[]>;
  stop(captureId: string, client: VmServiceClient): Promise<HttpEvent[]>;
  decode(input: { bodyB64: string; protoPath?: string; messageType: string }): Promise<unknown>;
  hasCapture(captureId: string): boolean;
  shutdown(): Promise<void>;
}

export function createHttpCaptureService(opts: { logger: Logger }): HttpCaptureService {
  const captures = new Map<string, Capture>();
  const logger = opts.logger.child({ component: 'httpCapture' });

  async function setLogging(
    client: VmServiceClient,
    isolateId: string,
    enabled: boolean,
  ): Promise<void> {
    try {
      await client.callServiceExtension('ext.dart.io.setHttpEnableTimelineLogging', {
        isolateId,
        args: { enabled: String(enabled) },
      });
    } catch (err) {
      logger.debug('setHttpEnableTimelineLogging failed', { err: String(err) });
    }
  }

  function isGrpcRequest(contentType: string | undefined): boolean {
    if (!contentType) return false;
    return /application\/grpc/i.test(contentType);
  }

  function grpcStatusFromHeaders(headers: Record<string, string> | undefined): number | undefined {
    if (!headers) return undefined;
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'grpc-status');
    if (!key) return undefined;
    const v = headers[key];
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  function normalizeHeaders(raw: unknown): Record<string, string> | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        out[k] = v.map(String).join(', ');
      } else if (typeof v === 'string') {
        out[k] = v;
      }
    }
    return out;
  }

  function extractBodyB64(profileRequest: Record<string, unknown> | undefined): string | undefined {
    if (!profileRequest) return undefined;
    const bodyBytes = profileRequest['bodyBytes'];
    if (Array.isArray(bodyBytes)) {
      const numeric = bodyBytes.filter((n): n is number => typeof n === 'number');
      return Buffer.from(Uint8Array.from(numeric)).toString('base64');
    }
    const bodyB64 = profileRequest['bodyB64'];
    if (typeof bodyB64 === 'string') return bodyB64;
    return undefined;
  }

  async function poll(capture: Capture, client: VmServiceClient): Promise<void> {
    try {
      const raw = await client.callServiceExtension('ext.dart.io.getHttpProfile', {
        isolateId: capture.isolateId,
        args:
          capture.lastTimelineMicros > 0
            ? { updatedSince: String(capture.lastTimelineMicros) }
            : {},
      });
      if (!raw || typeof raw !== 'object') return;
      const profile = raw as { requests?: unknown[]; timestamp?: number };
      const requests = profile.requests ?? [];
      for (const r of requests) {
        if (!r || typeof r !== 'object') continue;
        const obj = r as Record<string, unknown>;
        const id = String(obj['id'] ?? '');
        if (!id) continue;
        const method = String(obj['method'] ?? 'GET');
        const uri = String(obj['uri'] ?? '');
        const startTimeMicros = Number(obj['startTime'] ?? 0);
        const endTimeMicros = Number(obj['endTime'] ?? 0);
        const requestEnvelope = obj['request'] as Record<string, unknown> | undefined;
        const responseEnvelope = obj['response'] as Record<string, unknown> | undefined;
        const requestHeaders = normalizeHeaders(requestEnvelope?.['headers']);
        const responseHeaders = normalizeHeaders(responseEnvelope?.['headers']);
        const contentType =
          (requestHeaders && (requestHeaders['content-type'] ?? requestHeaders['Content-Type'])) ??
          (responseHeaders && (responseHeaders['content-type'] ?? responseHeaders['Content-Type']));
        const isGrpc = isGrpcRequest(contentType);
        const statusCode =
          responseEnvelope?.['statusCode'] !== undefined
            ? Number(responseEnvelope['statusCode'])
            : undefined;
        const requestBodyB64 = extractBodyB64(requestEnvelope);
        const responseBodyB64 = extractBodyB64(responseEnvelope);
        const grpcStatus = grpcStatusFromHeaders(responseHeaders);

        const ev: HttpEvent = {
          id,
          method,
          uri,
          ...(requestHeaders !== undefined ? { requestHeaders } : {}),
          ...(requestBodyB64 !== undefined ? { requestBodyB64 } : {}),
          ...(responseHeaders !== undefined ? { responseHeaders } : {}),
          ...(responseBodyB64 !== undefined ? { responseBodyB64 } : {}),
          ...(statusCode !== undefined ? { statusCode } : {}),
          ...(endTimeMicros > startTimeMicros
            ? { durationMs: (endTimeMicros - startTimeMicros) / 1000 }
            : {}),
          startedAt: Math.floor(startTimeMicros / 1000),
          ...(endTimeMicros > 0 ? { endedAt: Math.floor(endTimeMicros / 1000) } : {}),
          isGrpc,
          ...(grpcStatus !== undefined ? { grpcStatus } : {}),
          ...(contentType !== undefined ? { contentType } : {}),
        };
        capture.events.set(id, ev);
        if (endTimeMicros > capture.lastTimelineMicros) capture.lastTimelineMicros = endTimeMicros;
        else if (startTimeMicros > capture.lastTimelineMicros)
          capture.lastTimelineMicros = startTimeMicros;
      }
      if (typeof profile.timestamp === 'number' && profile.timestamp > capture.lastTimelineMicros) {
        capture.lastTimelineMicros = profile.timestamp;
      }
    } catch (err) {
      logger.debug('getHttpProfile poll failed', { err: String(err) });
    }
  }

  async function start(input: {
    sessionId: string;
    client: VmServiceClient;
    isolateId: string;
  }): Promise<{ captureId: string }> {
    const captureId = randomUUID();
    const capture: Capture = {
      captureId,
      sessionId: input.sessionId,
      isolateId: input.isolateId,
      lastTimelineMicros: 0,
      events: new Map(),
      startedAt: Date.now(),
    };
    captures.set(captureId, capture);
    await setLogging(input.client, input.isolateId, true);
    logger.info('http capture started', { captureId, sessionId: input.sessionId });
    return { captureId };
  }

  async function events(captureId: string, client: VmServiceClient): Promise<HttpEvent[]> {
    const capture = captures.get(captureId);
    if (!capture) throw new InvalidToolInputError(`Unknown captureId: ${captureId}`);
    await poll(capture, client);
    return Array.from(capture.events.values()).sort((a, b) => a.startedAt - b.startedAt);
  }

  async function stop(captureId: string, client: VmServiceClient): Promise<HttpEvent[]> {
    const capture = captures.get(captureId);
    if (!capture) throw new InvalidToolInputError(`Unknown captureId: ${captureId}`);
    await poll(capture, client);
    await setLogging(client, capture.isolateId, false);
    const final = Array.from(capture.events.values()).sort((a, b) => a.startedAt - b.startedAt);
    captures.delete(captureId);
    logger.info('http capture stopped', { captureId, total: final.length });
    return final;
  }

  function hasCapture(captureId: string): boolean {
    return captures.has(captureId);
  }

  async function decode(input: {
    bodyB64: string;
    protoPath?: string;
    messageType: string;
  }): Promise<unknown> {
    if (!input.protoPath) {
      throw new InvalidToolInputError(
        'decode_grpc_message requires `protoPath` pointing at the .proto file or a buf-cached descriptor.',
      );
    }
    let root: protobuf.Root;
    if (input.protoPath.endsWith('.json')) {
      const raw = await readFileFs(input.protoPath, 'utf8');
      root = protobuf.Root.fromJSON(JSON.parse(raw) as protobuf.INamespace);
    } else {
      root = await protobuf.load(input.protoPath);
    }
    const messageType = root.lookupType(input.messageType);
    const bytes = Buffer.from(input.bodyB64, 'base64');
    // gRPC framing: 1 byte (compressed flag) + 4 bytes length + payload.
    // Inputs may carry framing or not. Detect by length-prefix sanity.
    const body =
      bytes.length >= 5 && bytes[0] === 0 && bytes.readUInt32BE(1) + 5 === bytes.length
        ? bytes.subarray(5)
        : bytes;
    const decoded = messageType.decode(body);
    return messageType.toObject(decoded, {
      longs: String,
      enums: String,
      // protobufjs treats `String` as base64; `Array` would emit a number[].
      bytes: String,
      defaults: false,
      arrays: false,
      objects: false,
    });
  }

  async function shutdown(): Promise<void> {
    captures.clear();
  }

  return { start, events, stop, decode, hasCapture, shutdown };
}
