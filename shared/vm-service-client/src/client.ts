// VmServiceClient — the high-level typed surface over VmServiceTransport.
//
// Ports the 15-method subset from package:vm_service that the runtime + gesture
// MCP servers actually call (task #3 step 3), plus DDS-specific extensions:
//   - setClientName(name)   — DDS multi-client identification (plan §7.2)
//   - getStreamHistory(id)  — log/extension replay for runtime/get_logs
//
// Each method:
//   1. Calls transport.request(method, params)
//   2. Validates the response via the matching Zod schema
//   3. Throws SentinelException for methods that may return a Sentinel
//
// We never call requirePermissionToResume — VS Code's debugger must remain
// the sole resume authority per plan §7.2 (the "critical DDS detail").

import { EventEmitter } from 'node:events';
import { SentinelException } from './errors.js';
import { type ConnectTarget, type TransportOptions, VmServiceTransport } from './transport.js';
import {
  type EvaluateResult,
  EvaluateResultSchema,
  type Event,
  EventSchema,
  type FlagList,
  FlagListSchema,
  type InstanceSet,
  InstanceSetSchema,
  type Isolate,
  IsolateSchema,
  type JsonValue,
  type Obj,
  ObjSchema,
  type Sentinel,
  SentinelSchema,
  type Stack,
  StackSchema,
  type StreamHistory,
  StreamHistorySchema,
  type Success,
  SuccessSchema,
  type VM,
  VMSchema,
} from './types.js';

export interface VmServiceClientOptions extends TransportOptions {
  // DDS client name. Plan §7.2 requires unique-per-process so DDS's resume
  // coordination identifies us as a separate client from VS Code's debugger.
  // Format recommendation: `flutter-ultra/<server>/<pid>`.
  clientName?: string;
}

export type StepKind = 'Into' | 'Over' | 'OverAsyncSuspension' | 'Out' | 'Rewind';

export type VmServiceClientEvents = {
  isolateEvent: [Event];
  vmEvent: [Event];
  debugEvent: [Event];
  extensionEvent: [Event];
  loggingEvent: [Event];
  stdoutEvent: [Event];
  stderrEvent: [Event];
  serviceEvent: [Event];
  timelineEvent: [Event];
  // Catch-all for unrecognized streams.
  event: [streamId: string, event: Event];
  disconnect: [];
};

const STREAM_EVENT_MAP: Record<string, keyof VmServiceClientEvents> = {
  VM: 'vmEvent',
  Isolate: 'isolateEvent',
  Debug: 'debugEvent',
  Extension: 'extensionEvent',
  Logging: 'loggingEvent',
  Stdout: 'stdoutEvent',
  Stderr: 'stderrEvent',
  Service: 'serviceEvent',
  Timeline: 'timelineEvent',
};

export class VmServiceClient extends EventEmitter<VmServiceClientEvents> {
  readonly transport: VmServiceTransport;
  private clientName: string | undefined;

  constructor(target: ConnectTarget, options: VmServiceClientOptions = {}) {
    super();
    this.transport = new VmServiceTransport(target, options);
    this.clientName = options.clientName;

    this.transport.on('notification', (frame) => {
      // Notifications from streamListen arrive as method='streamNotify' with
      // params={streamId, event}. We re-emit on a typed channel per stream.
      if (
        frame.method === 'streamNotify' &&
        frame.params &&
        typeof frame.params === 'object' &&
        !Array.isArray(frame.params)
      ) {
        const params = frame.params as { streamId?: unknown; event?: unknown };
        const streamId = typeof params.streamId === 'string' ? params.streamId : undefined;
        const eventResult = EventSchema.safeParse(params.event);
        if (!streamId || !eventResult.success) return;
        const event = eventResult.data;
        const typedChannel = STREAM_EVENT_MAP[streamId];
        if (typedChannel) {
          // Type assertion: every entry in STREAM_EVENT_MAP keys a channel
          // with payload [Event].
          this.emit(typedChannel as 'isolateEvent', event);
        }
        this.emit('event', streamId, event);
      }
    });

    this.transport.on('close', () => {
      this.emit('disconnect');
    });
  }

  async connect(): Promise<void> {
    await this.transport.connect();
    if (this.clientName) {
      await this.setClientName(this.clientName);
    }
  }

  async dispose(): Promise<void> {
    await this.transport.dispose();
    this.removeAllListeners();
  }

  // -- Core RPCs --------------------------------------------------------------

  async getVM(): Promise<VM> {
    const raw = await this.transport.request('getVM');
    return VMSchema.parse(raw);
  }

  async getIsolate(isolateId: string): Promise<Isolate> {
    const raw = await this.transport.request('getIsolate', { isolateId });
    return this.parseOrThrowSentinel(raw, IsolateSchema, 'getIsolate');
  }

  async getObject(
    isolateId: string,
    objectId: string,
    opts: { offset?: number; count?: number } = {},
  ): Promise<Obj> {
    const params: Record<string, JsonValue> = { isolateId, objectId };
    if (opts.offset !== undefined) params.offset = opts.offset;
    if (opts.count !== undefined) params.count = opts.count;
    const raw = await this.transport.request('getObject', params);
    return this.parseOrThrowSentinel(raw, ObjSchema, 'getObject');
  }

  async evaluate(
    isolateId: string,
    targetId: string,
    expression: string,
    opts: { scope?: Record<string, string>; disableBreakpoints?: boolean } = {},
  ): Promise<EvaluateResult> {
    const params: Record<string, JsonValue> = { isolateId, targetId, expression };
    if (opts.scope) params.scope = opts.scope;
    if (opts.disableBreakpoints !== undefined) params.disableBreakpoints = opts.disableBreakpoints;
    const raw = await this.transport.request('evaluate', params);
    return EvaluateResultSchema.parse(raw);
  }

  async evaluateInFrame(
    isolateId: string,
    frameIndex: number,
    expression: string,
    opts: { scope?: Record<string, string>; disableBreakpoints?: boolean } = {},
  ): Promise<EvaluateResult> {
    const params: Record<string, JsonValue> = { isolateId, frameIndex, expression };
    if (opts.scope) params.scope = opts.scope;
    if (opts.disableBreakpoints !== undefined) params.disableBreakpoints = opts.disableBreakpoints;
    const raw = await this.transport.request('evaluateInFrame', params);
    return EvaluateResultSchema.parse(raw);
  }

  // Service extensions are the workhorse for ext.flutter.* and ext.flutter.ultra.*
  // The response shape is extension-defined, so we return raw JsonValue and
  // let the caller validate it against its own schema.
  async callServiceExtension(
    method: string,
    opts: { isolateId?: string; args?: Record<string, JsonValue> } = {},
  ): Promise<JsonValue> {
    const params: Record<string, JsonValue> = {};
    if (opts.isolateId !== undefined) params.isolateId = opts.isolateId;
    if (opts.args) Object.assign(params, opts.args);
    return this.transport.request(method, params);
  }

  async streamListen(streamId: string): Promise<Success> {
    const raw = await this.transport.request('streamListen', { streamId });
    return SuccessSchema.parse(raw);
  }

  async streamCancel(streamId: string): Promise<Success> {
    const raw = await this.transport.request('streamCancel', { streamId });
    return SuccessSchema.parse(raw);
  }

  async getFlagList(): Promise<FlagList> {
    const raw = await this.transport.request('getFlagList');
    return FlagListSchema.parse(raw);
  }

  async setLibraryDebuggable(
    isolateId: string,
    libraryId: string,
    isDebuggable: boolean,
  ): Promise<Success> {
    const raw = await this.transport.request('setLibraryDebuggable', {
      isolateId,
      libraryId,
      isDebuggable,
    });
    return SuccessSchema.parse(raw);
  }

  // Note: VM service spec name is `getInstances` (plural) — the singular
  // `getInstance` is not part of the official RPC list. We honor the task
  // description's intent by using the spec name.
  async getInstances(
    isolateId: string,
    objectId: string,
    limit: number,
    opts: { includeSubclasses?: boolean; includeImplementers?: boolean } = {},
  ): Promise<InstanceSet> {
    const params: Record<string, JsonValue> = { isolateId, objectId, limit };
    if (opts.includeSubclasses !== undefined) params.includeSubclasses = opts.includeSubclasses;
    if (opts.includeImplementers !== undefined)
      params.includeImplementers = opts.includeImplementers;
    const raw = await this.transport.request('getInstances', params);
    return InstanceSetSchema.parse(raw);
  }

  async getStack(isolateId: string, opts: { limit?: number } = {}): Promise<Stack> {
    const params: Record<string, JsonValue> = { isolateId };
    if (opts.limit !== undefined) params.limit = opts.limit;
    const raw = await this.transport.request('getStack', params);
    return StackSchema.parse(raw);
  }

  async resume(
    isolateId: string,
    opts: { step?: StepKind; frameIndex?: number } = {},
  ): Promise<Success> {
    const params: Record<string, JsonValue> = { isolateId };
    if (opts.step !== undefined) params.step = opts.step;
    if (opts.frameIndex !== undefined) params.frameIndex = opts.frameIndex;
    const raw = await this.transport.request('resume', params);
    return SuccessSchema.parse(raw);
  }

  async pause(isolateId: string): Promise<Success> {
    const raw = await this.transport.request('pause', { isolateId });
    return SuccessSchema.parse(raw);
  }

  // -- DDS RPCs ---------------------------------------------------------------

  async setClientName(name: string): Promise<Success> {
    const raw = await this.transport.request('setClientName', { name });
    return SuccessSchema.parse(raw);
  }

  async getStreamHistory(streamId: string): Promise<StreamHistory> {
    const raw = await this.transport.request('getStreamHistory', { streamId });
    return StreamHistorySchema.parse(raw);
  }

  // -- onIsolateEvent (AsyncIterable view over isolate events) ----------------
  //
  // Convenience for callers who prefer pull-iteration over EventEmitter.
  // Caller must have streamListen'd the corresponding stream first.

  onIsolateEvent(): AsyncIterableIterator<Event> {
    return this.iterateEvents('isolateEvent');
  }

  onExtensionEvent(): AsyncIterableIterator<Event> {
    return this.iterateEvents('extensionEvent');
  }

  onLoggingEvent(): AsyncIterableIterator<Event> {
    return this.iterateEvents('loggingEvent');
  }

  private iterateEvents(channel: keyof VmServiceClientEvents): AsyncIterableIterator<Event> {
    const queue: Event[] = [];
    const waiters: Array<(value: IteratorResult<Event>) => void> = [];
    let done = false;

    const handler = (event: Event): void => {
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    };

    const close = (): void => {
      done = true;
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter?.({ value: undefined, done: true });
      }
    };

    this.on(channel as 'isolateEvent', handler);
    this.once('disconnect', close);

    const iter: AsyncIterableIterator<Event> = {
      next: () => {
        if (queue.length > 0) {
          const value = queue.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (done) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<Event>>((resolve) => waiters.push(resolve));
      },
      return: () => {
        this.off(channel as 'isolateEvent', handler);
        this.off('disconnect', close);
        close();
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    return iter;
  }

  // -- Helpers ----------------------------------------------------------------

  private parseOrThrowSentinel<T>(
    raw: JsonValue,
    schema: { parse(input: unknown): T },
    method: string,
  ): T {
    const sentinel = SentinelSchema.safeParse(raw);
    if (sentinel.success) {
      const s: Sentinel = sentinel.data;
      throw new SentinelException(s.kind, s.valueAsString, method);
    }
    return schema.parse(raw);
  }
}
