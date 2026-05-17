// Internal tool-handler contract.
//
// Every tool exports the same shape so the central server can register
// them via a single loop. Each tool owns its Zod input schema and returns
// the JSON-serializable payload that lands in result.content[0].text.

import type { ZodTypeAny, z } from 'zod';
import type { PatrolServerEnv } from '../runtime/env.js';
import type { JobStore } from '../runtime/job-store.js';
import type { DevelopSessionManager } from '../runtime/develop-session.js';

export interface ToolContext {
  env: PatrolServerEnv;
  jobs: JobStore;
  develop: DevelopSessionManager;
  /** Wallclock now() override for deterministic tests. */
  now: () => number;
}

export interface PatrolTool<Schema extends ZodTypeAny> {
  /** Tool name as exposed to the MCP client (e.g. 'list_tests'). */
  name: string;
  /** One-paragraph description; trimmed to <300 chars in registration. */
  description: string;
  /** Zod input schema; the framework validates BEFORE handler invocation. */
  inputSchema: Schema;
  /** Pure handler — no global state, all deps via {@link ToolContext}. */
  handler(input: z.infer<Schema>, ctx: ToolContext): Promise<unknown> | unknown;
}

/** Helper for declaring tools without losing schema inference. */
export function defineTool<Schema extends ZodTypeAny>(t: PatrolTool<Schema>): PatrolTool<Schema> {
  return t;
}
