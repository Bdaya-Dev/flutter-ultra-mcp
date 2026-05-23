// Zod schemas for the subset of Dart VM service types this client surfaces.
//
// Conventions (binding per plan §16.2):
// - `.passthrough()` on VM service response types (the Dart VM includes private
//   `_`-prefixed fields like `_features`, `_profilerMode`, `_embedder`,
//   `_maxRSS` on native targets that web/DWDS omits — strict rejects these)
// - `.strict()` on internal protocol types (JsonRpcRequest, etc.) that we control
// - No `z.any()` / `z.record()`; service-extension args fall back to a
//   typed `JsonValue` recursion
// - `discriminatedUnion` on the `type` discriminator for polymorphic responses
//
// Coverage matches the 15-method subset locked in task #3 plus DDS extensions.

import { z } from 'zod';

// -- JSON primitives ----------------------------------------------------------

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

// -- Common envelope ----------------------------------------------------------
//
// Every VM service response carries a `type` field; ref-types use a leading
// `@` (e.g. `@Instance`) to indicate the lightweight variant.

const responseBase = z
  .object({
    type: z.string(),
  })
  .passthrough();

// -- Success / Sentinel -------------------------------------------------------

export const SuccessSchema = z
  .object({
    type: z.literal('Success'),
  })
  .passthrough();
export type Success = z.infer<typeof SuccessSchema>;

export const SentinelKindSchema = z.enum([
  'Collected',
  'Expired',
  'NotInitialized',
  'BeingInitialized',
  'OptimizedOut',
  'Free',
]);
export type SentinelKind = z.infer<typeof SentinelKindSchema>;

export const SentinelSchema = z
  .object({
    type: z.literal('Sentinel'),
    kind: SentinelKindSchema,
    valueAsString: z.string(),
  })
  .passthrough();
export type Sentinel = z.infer<typeof SentinelSchema>;

// -- Version / VM / Isolate ---------------------------------------------------

export const IsolateRefSchema = z
  .object({
    type: z.literal('@Isolate'),
    id: z.string(),
    number: z.string().optional(),
    name: z.string(),
    isSystemIsolate: z.boolean().optional(),
    isolateGroupId: z.string().optional(),
  })
  .passthrough();
export type IsolateRef = z.infer<typeof IsolateRefSchema>;

export const IsolateGroupRefSchema = z
  .object({
    type: z.literal('@IsolateGroup'),
    id: z.string(),
    number: z.string().optional(),
    name: z.string(),
    isSystemIsolateGroup: z.boolean().optional(),
  })
  .passthrough();
export type IsolateGroupRef = z.infer<typeof IsolateGroupRefSchema>;

export const VMSchema = z
  .object({
    type: z.literal('VM'),
    name: z.string(),
    architectureBits: z.number().int(),
    hostCPU: z.string(),
    operatingSystem: z.string(),
    targetCPU: z.string(),
    version: z.string(),
    pid: z.number().int(),
    startTime: z.number().int(),
    isolates: z.array(IsolateRefSchema),
    isolateGroups: z.array(IsolateGroupRefSchema),
    systemIsolates: z.array(IsolateRefSchema).optional(),
    systemIsolateGroups: z.array(IsolateGroupRefSchema).optional(),
  })
  .passthrough();
export type VM = z.infer<typeof VMSchema>;

// `Isolate` carries many fields we never inspect — preserve them as
// unknown to avoid spurious schema drift while keeping the parts the
// runtime/gesture servers actually need typed.
export const LibraryRefSchema = z
  .object({
    type: z.literal('@Library'),
    id: z.string(),
    name: z.string().optional(),
    uri: z.string().optional(),
  })
  .passthrough();
export type LibraryRef = z.infer<typeof LibraryRefSchema>;

export const PauseEventSchema = responseBase;
export type PauseEvent = z.infer<typeof PauseEventSchema>;

export const IsolateSchema = z
  .object({
    type: z.literal('Isolate'),
    id: z.string(),
    number: z.string(),
    name: z.string(),
    isSystemIsolate: z.boolean().optional(),
    isolateFlags: z.array(JsonValueSchema).optional(),
    startTime: z.number().int(),
    runnable: z.boolean(),
    livePorts: z.number().int(),
    pauseOnExit: z.boolean(),
    pauseEvent: PauseEventSchema.optional(),
    rootLib: LibraryRefSchema.optional(),
    libraries: z.array(LibraryRefSchema).optional(),
    breakpoints: z.array(JsonValueSchema).optional(),
    exceptionPauseMode: z.string().optional(),
    extensionRPCs: z.array(z.string()).optional(),
    isolateGroupId: z.string().optional(),
  })
  .passthrough();
export type Isolate = z.infer<typeof IsolateSchema>;

// -- Instance / Error / Object ------------------------------------------------

export const ClassRefSchema = z
  .object({
    type: z.literal('@Class'),
    id: z.string(),
    name: z.string(),
    library: LibraryRefSchema.optional(),
  })
  .passthrough();
export type ClassRef = z.infer<typeof ClassRefSchema>;

export const InstanceRefSchema = z
  .object({
    type: z.literal('@Instance'),
    id: z.string(),
    kind: z.string(),
    class: ClassRefSchema.optional(),
    identityHashCode: z.number().int().optional(),
    valueAsString: z.string().optional(),
    valueAsStringIsTruncated: z.boolean().optional(),
    length: z.number().int().optional(),
  })
  .passthrough();
export type InstanceRef = z.infer<typeof InstanceRefSchema>;

export const InstanceSchema = z
  .object({
    type: z.literal('Instance'),
    id: z.string(),
    kind: z.string(),
    class: ClassRefSchema,
    identityHashCode: z.number().int().optional(),
    valueAsString: z.string().optional(),
    length: z.number().int().optional(),
  })
  .passthrough();
export type Instance = z.infer<typeof InstanceSchema>;

export const ErrorRefSchema = z
  .object({
    type: z.literal('@Error'),
    id: z.string(),
    kind: z.string(),
    message: z.string(),
  })
  .passthrough();
export type ErrorRef = z.infer<typeof ErrorRefSchema>;

export const ErrorObjSchema = z
  .object({
    type: z.literal('Error'),
    id: z.string(),
    kind: z.string(),
    message: z.string(),
    exception: InstanceRefSchema.optional(),
    stacktrace: InstanceRefSchema.optional(),
  })
  .passthrough();
export type ErrorObj = z.infer<typeof ErrorObjSchema>;

// Polymorphic response: evaluate / evaluateInFrame return one of these.
export const EvaluateResultSchema = z.discriminatedUnion('type', [
  InstanceRefSchema,
  ErrorRefSchema,
  SentinelSchema,
]);
export type EvaluateResult = z.infer<typeof EvaluateResultSchema>;

// getObject can return any object kind. We type the common variants and
// fall back to a passthrough for the long tail (Library, Script, Field, etc.).
export const ObjSchema = z
  .object({
    type: z.string(),
    id: z.string(),
  })
  .passthrough();
export type Obj = z.infer<typeof ObjSchema>;

// -- InstanceSet (getInstances) ----------------------------------------------

export const InstanceSetSchema = z
  .object({
    type: z.literal('InstanceSet'),
    totalCount: z.number().int(),
    instances: z.array(InstanceRefSchema),
  })
  .passthrough();
export type InstanceSet = z.infer<typeof InstanceSetSchema>;

// -- Stack --------------------------------------------------------------------

export const FrameSchema = z
  .object({
    type: z.literal('Frame'),
    index: z.number().int(),
    function: JsonValueSchema.optional(),
    code: JsonValueSchema.optional(),
    location: JsonValueSchema.optional(),
    vars: z.array(JsonValueSchema).optional(),
    kind: z.string().optional(),
  })
  .passthrough();
export type Frame = z.infer<typeof FrameSchema>;

export const StackSchema = z
  .object({
    type: z.literal('Stack'),
    frames: z.array(FrameSchema),
    asyncCausalFrames: z.array(FrameSchema).optional(),
    awaiterFrames: z.array(FrameSchema).optional(),
    messages: z.array(JsonValueSchema).optional(),
    truncated: z.boolean(),
  })
  .passthrough();
export type Stack = z.infer<typeof StackSchema>;

// -- Flags --------------------------------------------------------------------

export const FlagSchema = z
  .object({
    name: z.string(),
    comment: z.string(),
    modified: z.boolean(),
    valueAsString: z.string().optional(),
  })
  .passthrough();
export type Flag = z.infer<typeof FlagSchema>;

export const FlagListSchema = z
  .object({
    type: z.literal('FlagList'),
    flags: z.array(FlagSchema),
  })
  .passthrough();
export type FlagList = z.infer<typeof FlagListSchema>;

// -- Events (stream) ----------------------------------------------------------

export const EventKindSchema = z.enum([
  'VMUpdate',
  'VMFlagUpdate',
  'IsolateStart',
  'IsolateRunnable',
  'IsolateExit',
  'IsolateUpdate',
  'IsolateReload',
  'ServiceExtensionAdded',
  'PauseStart',
  'PauseExit',
  'PauseBreakpoint',
  'PauseInterrupted',
  'PauseException',
  'PausePostRequest',
  'Resume',
  'None',
  'BreakpointAdded',
  'BreakpointResolved',
  'BreakpointRemoved',
  'GC',
  'WriteEvent',
  'Inspect',
  'Extension',
  'Logging',
  'TimelineEvents',
  'CpuSamples',
  'UserTagChanged',
  'ServiceRegistered',
  'ServiceUnregistered',
  'TimerSignificantlyOverdue',
]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const EventSchema = z
  .object({
    type: z.literal('Event'),
    kind: z.string(),
    timestamp: z.number().int(),
    isolate: IsolateRefSchema.optional(),
    isolateGroup: IsolateGroupRefSchema.optional(),
    extensionRPC: z.string().optional(),
    extensionKind: z.string().optional(),
    extensionData: JsonValueSchema.optional(),
    logRecord: JsonValueSchema.optional(),
    bytes: z.string().optional(),
    service: z.string().optional(),
    method: z.string().optional(),
    alias: z.string().optional(),
  })
  .passthrough();
export type Event = z.infer<typeof EventSchema>;

// -- DDS extension types ------------------------------------------------------

export const StreamHistorySchema = z
  .object({
    type: z.literal('StreamHistory'),
    history: z.array(EventSchema),
  })
  .passthrough();
export type StreamHistory = z.infer<typeof StreamHistorySchema>;

export const ClientNameSchema = z
  .object({
    type: z.literal('ClientName'),
    name: z.string(),
  })
  .strict();
export type ClientName = z.infer<typeof ClientNameSchema>;

// -- JSON-RPC 2.0 envelopes ---------------------------------------------------

export const JsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]),
    method: z.string(),
    params: JsonValueSchema.optional(),
  })
  .strict();
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number(), z.null()]),
    result: JsonValueSchema.optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string(),
        data: JsonValueSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough()
  .refine(
    (d) => d.result !== undefined || d.error !== undefined,
    'JSON-RPC 2.0 response must contain either result or error',
  );
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

export const JsonRpcNotificationSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.string(),
    params: JsonValueSchema.optional(),
  })
  .strict();
export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;

// Convenience union for incoming frames.
export const IncomingFrameSchema = z.union([JsonRpcResponseSchema, JsonRpcNotificationSchema]);
export type IncomingFrame = z.infer<typeof IncomingFrameSchema>;
