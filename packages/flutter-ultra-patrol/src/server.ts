// Central MCP server wiring for flutter-ultra-patrol.
//
// Registers all 17 tools (13 original per plan §17B.1 + extract_video_frame + run_patrol_doctor + get_patrol_native_tree + patrol_session_status), validates input through
// each tool's Zod schema, dispatches to the handler, and serialises the
// return value into MCP CallToolResult shape. Throws are caught and
// re-emitted as `{ isError: true, content: [{ type:'text', text:... }] }`
// so the agent always sees a structured response.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';

import { readEnv, type PatrolServerEnv } from './runtime/env.js';
import { JobStore } from './runtime/job-store.js';
import { DevelopSessionManager } from './runtime/develop-session.js';
import { createLogger, type Logger } from './runtime/logger.js';

import { listTestsTool } from './tools/list-tests.js';
import { startPatrolTestTool } from './tools/start-patrol-test.js';
import { pollPatrolJobTool } from './tools/poll-patrol-job.js';
import { getPatrolResultTool } from './tools/get-patrol-result.js';
import { cancelPatrolJobTool } from './tools/cancel-patrol-job.js';
import { startPatrolDevelopTool } from './tools/start-patrol-develop.js';
import { patrolDevelopRunTool } from './tools/patrol-develop-run.js';
import { patrolHotReloadTool } from './tools/patrol-hot-reload.js';
import { takePatrolScreenshotTool } from './tools/take-patrol-screenshot.js';
import { startPatrolRecordingTool } from './tools/start-patrol-recording.js';
import { stopPatrolRecordingTool } from './tools/stop-patrol-recording.js';
import { getPatrolBrowserErrorsTool } from './tools/get-patrol-browser-errors.js';
import { getPatrolWebDebuggerPortTool } from './tools/get-patrol-web-debugger-port.js';
import { extractVideoFrameTool } from './tools/extract-video-frame.js';
import { patrolDoctorTool } from './tools/patrol-doctor.js';
import { getPatrolNativeTreeTool } from './tools/get-patrol-native-tree.js';
import { patrolSessionStatusTool } from './tools/patrol-session-status.js';
import type { PatrolTool, ToolContext } from './tools/types.js';

export const SERVER_NAME = 'flutter-ultra-patrol';
export const SERVER_VERSION = '0.0.0';

// 17 tools: 13 original per plan §17B.1 + extract_video_frame (GitHub issue #43) + run_patrol_doctor (GitHub issue #83) + get_patrol_native_tree + patrol_session_status.
export const TOOLS: ReadonlyArray<PatrolTool<ZodTypeAny>> = [
  listTestsTool,
  startPatrolTestTool,
  pollPatrolJobTool,
  getPatrolResultTool,
  cancelPatrolJobTool,
  startPatrolDevelopTool,
  patrolDevelopRunTool,
  patrolHotReloadTool,
  takePatrolScreenshotTool,
  startPatrolRecordingTool,
  stopPatrolRecordingTool,
  getPatrolBrowserErrorsTool,
  getPatrolWebDebuggerPortTool,
  extractVideoFrameTool,
  patrolDoctorTool,
  getPatrolNativeTreeTool,
  patrolSessionStatusTool,
];

export interface CreatePatrolServerOptions {
  env?: PatrolServerEnv;
  logger?: Logger;
  jobs?: JobStore;
  develop?: DevelopSessionManager;
  now?: () => number;
}

export interface PatrolServerHandle {
  server: Server;
  ctx: ToolContext;
  logger: Logger;
  /** Resolves once persisted jobs have been recovered from disk. */
  recovered: Promise<void>;
}

export function createPatrolServer(opts: CreatePatrolServerOptions = {}): PatrolServerHandle {
  const env = opts.env ?? readEnv();
  const logger = opts.logger ?? createLogger({ server: SERVER_NAME, minLevel: env.logLevel });
  const jobs = opts.jobs ?? new JobStore(env.stateDir ? { stateDir: env.stateDir } : {});
  const develop = opts.develop ?? new DevelopSessionManager();
  const now = opts.now ?? Date.now.bind(Date);
  const ctx: ToolContext = { env, jobs, develop, now };

  const recovered = jobs.recover().then((recs) => {
    if (recs.length > 0) {
      logger.info('recovered jobs from disk', { count: recs.length });
    }
  });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, logging: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map(toMcpTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      return errorResult(`Unknown tool: ${name}`);
    }
    const parsed = (tool.inputSchema as ZodTypeAny).safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      return errorResult(`Input validation failed for ${name}: ${formatZodError(parsed.error)}`);
    }
    try {
      const value = await tool.handler(parsed.data, ctx);
      const result: CallToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(value, null, 2),
          },
        ],
      };
      return result;
    } catch (err) {
      logger.error('tool handler threw', {
        tool: name,
        message: err instanceof Error ? err.message : String(err),
      });
      return errorResult(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }
  });

  return { server, ctx, logger, recovered };
}

function toMcpTool(t: PatrolTool<ZodTypeAny>): McpTool {
  return {
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema as ZodTypeAny),
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
}

// Minimal Zod→JSON-Schema bridge. The MCP SDK's official @modelcontextprotocol
// adapter would pull in zod-to-json-schema; staying tiny keeps the
// dependency surface small. We only emit the keys the MCP client uses for
// tool documentation: type=object, properties, required, additionalProperties.
function zodToJsonSchema(schema: ZodTypeAny): McpTool['inputSchema'] {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, object> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      const sub = renderZod(v);
      properties[k] = sub.schema;
      if (!sub.optional) required.push(k);
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    };
  }
  return { type: 'object' };
}

interface RenderedZod {
  schema: Record<string, unknown> & object;
  optional: boolean;
}

function renderZod(node: ZodTypeAny): RenderedZod {
  let optional = false;
  let current: ZodTypeAny = node;
  while (current instanceof z.ZodOptional || current instanceof z.ZodDefault) {
    optional = true;
    current = current._def.innerType as ZodTypeAny;
  }
  const description: string | undefined = (current as { description?: string }).description;

  if (current instanceof z.ZodString)
    return { schema: withDesc({ type: 'string' }, description), optional };
  if (current instanceof z.ZodNumber)
    return { schema: withDesc({ type: 'number' }, description), optional };
  if (current instanceof z.ZodBoolean)
    return { schema: withDesc({ type: 'boolean' }, description), optional };
  if (current instanceof z.ZodEnum) {
    const values = (current._def.values ?? []) as string[];
    return {
      schema: withDesc({ type: 'string', enum: values }, description),
      optional,
    };
  }
  if (current instanceof z.ZodArray) {
    const item = renderZod(current._def.type as ZodTypeAny);
    return {
      schema: withDesc({ type: 'array', items: item.schema }, description),
      optional,
    };
  }
  if (current instanceof z.ZodRecord) {
    const value = renderZod(current._def.valueType as ZodTypeAny);
    return {
      schema: withDesc({ type: 'object', additionalProperties: value.schema }, description),
      optional,
    };
  }
  if (current instanceof z.ZodUnion) {
    const opts = (current._def.options as ZodTypeAny[]).map((o) => renderZod(o).schema);
    return { schema: withDesc({ oneOf: opts }, description), optional };
  }
  if (current instanceof z.ZodObject) {
    return { schema: zodToJsonSchema(current), optional };
  }
  return { schema: withDesc({}, description), optional };
}

function withDesc(
  base: Record<string, unknown>,
  description: string | undefined,
): Record<string, unknown> {
  if (description) return { ...base, description };
  return base;
}
