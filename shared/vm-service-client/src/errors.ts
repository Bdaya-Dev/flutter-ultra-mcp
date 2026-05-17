// JSON-RPC 2.0 + Dart VM service error model.
//
// VM service uses standard JSON-RPC 2.0 error codes (-32700..-32603) plus
// service-specific codes (100..115). DDS adds -32010 for ConnectionDisposed.
// Reference: pkg/vm_service CHANGELOG entries for kVmMustBePaused etc.

export const RpcErrorCode = {
  // JSON-RPC 2.0 standard codes
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,

  // DDS extensions
  ConnectionDisposed: -32010,

  // VM service service-specific
  ServerError: -32000,
  FeatureDisabled: 100,
  StreamAlreadySubscribed: 103,
  StreamNotSubscribed: 104,
  IsolateMustBeRunnable: 105,
  IsolateMustBePaused: 106,
  CannotAddBreakpoint: 102,
  IsolateCannotBeResumed: 107,
  IsolateIsReloading: 108,
  IsolateCannotReload: 109,
  IsolateNoReloadChangesApplied: 110,
  VmMustBePaused: 111,
  CannotGetQueuedMicrotasks: 115,
} as const;

export type RpcErrorCodeValue = (typeof RpcErrorCode)[keyof typeof RpcErrorCode];

export interface RpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  readonly method: string | undefined;

  constructor(payload: RpcErrorPayload, method?: string) {
    super(
      method ? `[${method}] (${payload.code}) ${payload.message}` : `(${payload.code}) ${payload.message}`,
    );
    this.name = 'RpcError';
    this.code = payload.code;
    this.data = payload.data;
    this.method = method;
  }
}

// Thrown when an RPC that may return a Sentinel actually did. Caller decides
// whether to recover (isolate gone, object collected) or propagate.
export class SentinelException extends Error {
  readonly kind: string;
  readonly valueAsString: string;
  readonly method: string | undefined;

  constructor(kind: string, valueAsString: string, method?: string) {
    super(method ? `[${method}] Sentinel(${kind}): ${valueAsString}` : `Sentinel(${kind}): ${valueAsString}`);
    this.name = 'SentinelException';
    this.kind = kind;
    this.valueAsString = valueAsString;
    this.method = method;
  }
}

// Thrown when the underlying WS connection has been disposed and the caller
// invokes an RPC. Distinct from RpcError so the runtime server's session
// state machine can reattach without parsing message strings.
export class ConnectionDisposedError extends Error {
  constructor(message = 'VM service connection has been disposed') {
    super(message);
    this.name = 'ConnectionDisposedError';
  }
}

export class ConnectionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionTimeoutError';
  }
}
