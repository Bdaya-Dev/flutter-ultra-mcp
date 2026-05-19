// Shared MCP server scaffolding.
//
// One createServer() + defineTool() per package. Each tool gets:
//   - Zod-validated input (raw shape; MCP SDK builds the JSON schema)
//   - Watchdog wrapper with timeout ceiling
//   - AbortSignal forwarded from MCP CancelledNotification
//   - Progress notifications via progressToken (RequestHandlerExtra)
//   - Structured error result on failure (isError: true)
//
// Tools register on the McpServer via server.tool(name, ..., handler).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type {
  CallToolResult,
  LoggingMessageNotification,
} from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';
import { createLogger, type Logger, type LoggerOptions } from './logger.js';
import { redactVmServiceToken } from './redact.js';
import { createDiagnosticsTool, DiagnosticsCollector } from './diagnostics.js';
import { startKeepAlive } from './keepAlive.js';
import {
  type ProgressUpdate,
  type TimeoutClass,
  type ToolContext,
  runWithWatchdog,
} from './watchdog.js';
import {
  InvalidToolInputError,
  SessionNotFoundError,
  SessionTerminatedError,
  ToolCancelledError,
  ToolWatchdogTimeoutError,
} from './errors.js';

export interface ServerInfo {
  name: string;
  version: string;
}

export interface CreateServerOptions {
  info: ServerInfo;
  logger?: LoggerOptions;
  keepAliveIntervalMs?: number;
}

export interface FlutterUltraServer {
  readonly mcp: McpServer;
  readonly logger: Logger;
  defineTool<Shape extends ZodRawShape, Result>(
    config: DefineToolConfig<Shape>,
    body: (args: z.objectOutputType<Shape, z.ZodTypeAny>, ctx: ToolContext) => Promise<Result>,
  ): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface DefineToolConfig<Shape extends ZodRawShape> {
  name: string;
  description: string;
  // Raw Zod shape — MCP SDK expects an object literal of Zod types, not a
  // z.object() instance.
  inputShape?: Shape;
  // For tools with no input, omit inputShape entirely.
  timeoutClass: TimeoutClass;
  ceilingMs?: number;
  // Annotation hints for the MCP client UI / agent.
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export function createServer(opts: CreateServerOptions): FlutterUltraServer {
  const mcp = new McpServer(opts.info, {
    capabilities: {
      logging: {},
      tools: { listChanged: false },
    },
  });
  const logger = createLogger({ server: opts.info.name, ...(opts.logger ?? {}) });
  const diagnostics = new DiagnosticsCollector();
  let stopKeepAlive: (() => void) | null = null;
  let started = false;

  const defineTool: FlutterUltraServer['defineTool'] = (config, body) => {
    const annotations = {
      title: config.annotations?.title ?? config.name,
      ...(config.annotations?.readOnlyHint !== undefined
        ? { readOnlyHint: config.annotations.readOnlyHint }
        : {}),
      ...(config.annotations?.destructiveHint !== undefined
        ? { destructiveHint: config.annotations.destructiveHint }
        : {}),
      ...(config.annotations?.idempotentHint !== undefined
        ? { idempotentHint: config.annotations.idempotentHint }
        : {}),
      ...(config.annotations?.openWorldHint !== undefined
        ? { openWorldHint: config.annotations.openWorldHint }
        : {}),
    };

    const inputShape = (config.inputShape ?? {}) as ZodRawShape;

    mcp.tool(
      config.name,
      config.description,
      inputShape,
      annotations,
      async (args: unknown, extra): Promise<CallToolResult> => {
        const callLogger = logger.child({ tool: config.name });
        const sendProgress = (update: ProgressUpdate): void => {
          const token = extra._meta?.progressToken;
          if (token === undefined || token === null) return;
          if (typeof extra.sendNotification !== 'function') return;
          extra
            .sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken: token,
                progress: update.progress,
                ...(update.total !== undefined ? { total: update.total } : {}),
                ...(update.message !== undefined ? { message: update.message } : {}),
              },
            })
            .catch((err: unknown) => {
              callLogger.debug('progress notification failed', { err: String(err) });
            });
        };

        diagnostics.recordToolCall(config.name);
        const externalSignal = extra.signal;
        try {
          const result = await runWithWatchdog(
            {
              name: config.name,
              timeoutClass: config.timeoutClass,
              ...(config.ceilingMs !== undefined ? { ceilingMs: config.ceilingMs } : {}),
            },
            args as z.objectOutputType<typeof inputShape, z.ZodTypeAny>,
            externalSignal,
            sendProgress,
            body as (
              args: z.objectOutputType<typeof inputShape, z.ZodTypeAny>,
              ctx: ToolContext,
            ) => Promise<unknown>,
          );
          return toCallToolResult(result);
        } catch (err) {
          return toErrorResult(err, callLogger);
        }
      },
    );
  };

  return {
    mcp,
    logger,
    defineTool,
    async start() {
      if (started) return;
      started = true;
      // Auto-register the built-in diagnostics tool before connecting.
      defineTool(createDiagnosticsTool(diagnostics), async () => diagnostics.snapshot());
      const transport = new StdioServerTransport();
      await mcp.connect(transport);
      stopKeepAlive = startKeepAlive(
        mcp,
        opts.keepAliveIntervalMs !== undefined ? { intervalMs: opts.keepAliveIntervalMs } : {},
      );
      logger.info('server started', { pid: process.pid });
    },
    async stop() {
      if (!started) return;
      stopKeepAlive?.();
      stopKeepAlive = null;
      try {
        await mcp.close();
      } catch (err) {
        logger.warn('mcp.close threw', { err: String(err) });
      }
      started = false;
    },
  };
}

// Convert handler return values into the MCP CallToolResult envelope.
// We accept either a CallToolResult-like {content, isError, structuredContent}
// or a plain JSON value (returned as a single text block of JSON.stringify).
function toCallToolResult(value: unknown): CallToolResult {
  if (
    value &&
    typeof value === 'object' &&
    'content' in (value as object) &&
    Array.isArray((value as CallToolResult).content)
  ) {
    return value as CallToolResult;
  }
  // Return as structured + text mirror so both human-reading agents and
  // JSON-consuming agents get a usable response.
  return {
    content: [{ type: 'text', text: redactVmServiceToken(JSON.stringify(value)) }],
    structuredContent: (value as Record<string, unknown>) ?? undefined,
  };
}

function toErrorResult(err: unknown, logger: Logger): CallToolResult {
  if (err instanceof ToolWatchdogTimeoutError) {
    logger.warn('tool watchdog fired', { ceilingMs: err.ceilingMs });
    return {
      content: [
        {
          type: 'text',
          text: `Tool '${err.toolName}' exceeded its ${err.ceilingMs}ms ceiling. Internal resources cleaned up. If this is expected for your workload, increase via env var FLUTTER_ULTRA_TOOL_TIMEOUT_${err.toolName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}.`,
        },
      ],
      isError: true,
      structuredContent: {
        error: 'watchdog_timeout',
        tool: err.toolName,
        ceilingMs: err.ceilingMs,
      },
    };
  }
  if (err instanceof ToolCancelledError) {
    logger.info('tool cancelled by client');
    return {
      content: [{ type: 'text', text: `Tool '${err.toolName}' was cancelled.` }],
      isError: true,
      structuredContent: { error: 'cancelled', tool: err.toolName },
    };
  }
  if (err instanceof SessionNotFoundError) {
    return {
      content: [{ type: 'text', text: err.message }],
      isError: true,
      structuredContent: { error: 'session_not_found', sessionId: err.sessionId },
    };
  }
  if (err instanceof SessionTerminatedError) {
    return {
      content: [{ type: 'text', text: err.message }],
      isError: true,
      structuredContent: { error: 'session_terminated', sessionId: err.sessionId },
    };
  }
  if (err instanceof InvalidToolInputError) {
    return {
      content: [{ type: 'text', text: err.message }],
      isError: true,
      structuredContent: { error: 'invalid_input', message: err.message },
    };
  }
  if (err instanceof z.ZodError) {
    return {
      content: [{ type: 'text', text: `Validation error: ${err.message}` }],
      isError: true,
      structuredContent: { error: 'validation', issues: err.issues },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error('tool body threw', { err: message });
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: { error: 'internal', message },
  };
}

// Re-export so consumers don't have to dig.
export type { LoggingMessageNotification };
