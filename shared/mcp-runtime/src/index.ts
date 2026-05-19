// Public surface of @flutter-ultra/mcp-runtime.
//
// Shared MCP server scaffolding: stdio transport, watchdog, keep-alive,
// structured logging, session model, finder spec.

export {
  createServer,
  type CreateServerOptions,
  type DefineToolConfig,
  type FlutterUltraServer,
  type ServerInfo,
} from './server.js';

export {
  createLogger,
  LogBuffer,
  type LogEntry,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from './logger.js';

export {
  createDiagnosticsTool,
  DiagnosticsCollector,
  type DiagnosticsSnapshot,
} from './diagnostics.js';

export {
  DEFAULT_CEILINGS_MS,
  runWithWatchdog,
  type ProgressUpdate,
  type TimeoutClass,
  type ToolBody,
  type ToolContext,
  type WatchdogConfig,
} from './watchdog.js';

export { startKeepAlive, type KeepAliveOptions } from './keepAlive.js';

export {
  InvalidToolInputError,
  SessionNotFoundError,
  SessionTerminatedError,
  ToolCancelledError,
  ToolWatchdogTimeoutError,
} from './errors.js';

export {
  emptySessionsFile,
  makeClientName,
  SessionIdSchema,
  SessionResource,
  SessionSchema,
  SessionsFileSchema,
  SessionSourceSchema,
  SessionStatusSchema,
  type Session,
  type SessionId,
  type SessionsFile,
  type SessionSource,
  type SessionStatus,
} from './session.js';

export { redactVmServiceToken } from './redact.js';

export {
  FinderSchema,
  matchesText,
  RectSchema,
  TextMatchTypeSchema,
  type FinderSpec,
  type Rect,
  type TextMatchType,
} from './finder.js';
