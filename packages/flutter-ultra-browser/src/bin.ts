#!/usr/bin/env node
// MCP server binary for flutter-ultra-browser.
//
// Invoked by Claude Code as a stdio child process. Builds the tool
// registry, creates the MCP server, connects stdio transport, and
// installs signal + cleanup handlers.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { browserManager } from './browserManager.js';
import { log } from './logger.js';
import { buildToolRegistry, SERVER_NAME } from './index.js';
import { withWatchdog, type ToolContext } from './watchdog.js';
import { fail } from './result.js';

async function main(): Promise<void> {
  const registry = buildToolRegistry();
  log.info('starting', { tools: registry.size });

  const server = new Server(
    { name: SERVER_NAME, version: '0.0.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(registry.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }) as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const tool = registry.get(req.params.name);
    if (!tool) {
      return fail(
        `Unknown tool: ${req.params.name}`,
        `Known tools: ${Array.from(registry.keys()).join(', ')}.`,
      ) as never;
    }
    const parsed = tool.schema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      return fail(
        `Invalid arguments for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        'Re-call with arguments matching the tool inputSchema.',
      ) as never;
    }

    const wrapped = withWatchdog({ name: tool.name, ...tool.meta }, tool.handler);
    const ctx: Partial<ToolContext> = {
      signal: extra.signal,
      sendProgress: (p) => {
        const token = (req.params._meta as { progressToken?: string | number } | undefined)
          ?.progressToken;
        if (token === undefined) return;
        void server.notification({
          method: 'notifications/progress',
          params: { progressToken: token, ...p },
        });
      },
    };
    const result = await wrapped(parsed.data, ctx);
    return result as never;
  });

  const transport = new StdioServerTransport();

  let shutdown = false;
  const cleanup = async (sig: string) => {
    if (shutdown) return;
    shutdown = true;
    log.info('shutdown', { signal: sig });
    try {
      await browserManager.shutdownAll();
    } catch (err) {
      log.warn('shutdown_failure', { err: (err as Error).message });
    }
    try {
      await server.close();
    } catch {
      // already closed
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void cleanup('SIGTERM'));
  process.on('SIGINT', () => void cleanup('SIGINT'));
  process.stdin.once('close', () => void cleanup('stdin-close'));

  await server.connect(transport);
  log.info('ready');
}

main().catch((err) => {
  log.error('fatal', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
