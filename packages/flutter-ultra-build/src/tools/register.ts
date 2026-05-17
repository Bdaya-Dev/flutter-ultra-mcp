/**
 * Tool registration helpers.
 *
 * Every domain module exports a `register(server: McpServer)` function that
 * the entrypoint calls. This keeps the entrypoint tiny and lets tests
 * register a subset against a mock server.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod';
import { withWatchdog, type WatchdogConfig, type WatchedHandler } from '../runtime/watchdog.js';

export interface DefineToolOptions<Args> {
  name: string;
  description: string;
  /** zod raw shape (`{key: ZodSchema}`) — SDK wraps it in z.object().strict() */
  inputSchema?: ZodRawShape;
  watchdog: WatchdogConfig;
  handler: WatchedHandler<Args>;
}

export function defineTool<Args>(server: McpServer, opts: DefineToolOptions<Args>): void {
  const wrapped = withWatchdog<Args>(opts.watchdog, opts.handler);
  server.registerTool(
    opts.name,
    {
      description: opts.description,
      ...(opts.inputSchema ? { inputSchema: opts.inputSchema } : {}),
    },
    // The SDK passes (args, extra). We expose the same to our watchdog wrapper.
    // Use `unknown` casts here because the SDK's generic inference doesn't
    // know about our additional WatchedHandler shape.
    wrapped as unknown as Parameters<typeof server.registerTool>[2],
  );
}
