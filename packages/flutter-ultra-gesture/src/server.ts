// MCP server construction. Registers 17 gesture tools per plan §5.3.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { SessionRegistry } from './session.js';
import { allTools, type GestureTool } from './tools/index.js';

export interface GestureServerOptions {
  stateDir?: string;
}

export function createGestureServer(options: GestureServerOptions = {}): Server {
  const server = new Server(
    {
      name: 'flutter-ultra-gesture',
      version: '0.0.1',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const registry = new SessionRegistry({
    ...(options.stateDir !== undefined ? { stateDir: options.stateDir } : {}),
  });
  const tools = allTools(registry);
  const toolMap = new Map<string, GestureTool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputJsonSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolMap.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      };
    }
    const parsedInput = tool.inputSchema.safeParse(request.params.arguments ?? {});
    if (!parsedInput.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid input for ${tool.name}: ${parsedInput.error.message}`,
          },
        ],
      };
    }
    try {
      const result = await tool.handler(parsedInput.data);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  });

  // Best-effort cleanup of cached VmServiceClients.
  server.onclose = (): void => {
    void registry.disposeAll();
  };

  return server;
}
