#!/usr/bin/env node
// flutter-ultra-devtools MCP server entrypoint.
//
// Plan §5.7. Tool catalog: start_panel_server, stop_panel_server,
// panel_status, push_event, panel_command.

import { createServer } from '@flutter-ultra/mcp-runtime';
import { z } from 'zod';
import { PanelServer } from './panelServer.js';
import { EventBus } from './eventBus.js';

const server = createServer({
  info: { name: 'flutter-ultra-devtools', version: '0.1.0' },
});

const panelServer = new PanelServer(server.logger);
const eventBus = new EventBus(panelServer);

server.defineTool(
  {
    name: 'start_panel_server',
    description:
      'Start the WebSocket listener that the DevTools extension panel connects to. Returns the WS URL for the panel iframe.',
    inputShape: {
      port: z.number().int().min(1024).max(65535).default(9170).describe('Port to listen on'),
    },
    timeoutClass: 'quick',
    ceilingMs: 15_000,
    annotations: {
      title: 'Start DevTools Panel Server',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (args) => {
    const url = await panelServer.start(args.port);
    return { url, port: args.port, status: 'listening' };
  },
);

server.defineTool(
  {
    name: 'stop_panel_server',
    description: 'Stop the WebSocket listener and disconnect all panel viewers.',
    timeoutClass: 'quick',
    ceilingMs: 15_000,
    annotations: {
      title: 'Stop DevTools Panel Server',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async () => {
    await panelServer.stop();
    return { status: 'stopped' };
  },
);

server.defineTool(
  {
    name: 'panel_status',
    description:
      'Check whether the panel WS server is running and how many viewers are connected.',
    timeoutClass: 'instant',
    ceilingMs: 5_000,
    annotations: {
      title: 'Panel Status',
      readOnlyHint: true,
    },
  },
  async () => {
    return panelServer.getStatus();
  },
);

server.defineTool(
  {
    name: 'push_event',
    description:
      'Push a structured event to all connected DevTools panels. Used internally by other servers via the shared devtools-bus, or manually by the agent for custom notifications.',
    inputShape: {
      type: z
        .enum(['tool_call', 'tool_result', 'session_change', 'log', 'screenshot', 'error', 'custom'])
        .describe('Event type category'),
      server: z.string().optional().describe('Originating server name'),
      tool: z.string().optional().describe('Tool name (for tool_call/tool_result events)'),
      payload: z.record(z.unknown()).optional().describe('Arbitrary event payload'),
    },
    timeoutClass: 'instant',
    ceilingMs: 5_000,
    annotations: {
      title: 'Push Event to Panel',
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  async (args) => {
    const event = eventBus.createEvent(args.type, args.server, args.tool, args.payload);
    const delivered = panelServer.broadcast(event);
    return { delivered, eventId: event.id };
  },
);

server.defineTool(
  {
    name: 'panel_command',
    description:
      'Block until a connected DevTools panel sends a command (human-in-the-loop). The panel user clicks Pause/Resume or injects a manual instruction. Returns the command payload when received, or times out.',
    inputShape: {
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .default(300_000)
        .describe('How long to wait for a panel command (ms)'),
      prompt: z
        .string()
        .optional()
        .describe('Optional prompt text shown to the panel user while waiting'),
    },
    timeoutClass: 'marathon',
    ceilingMs: 600_000,
    annotations: {
      title: 'Wait for Panel Command',
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async (args, ctx) => {
    if (args.prompt) {
      panelServer.broadcast(
        eventBus.createEvent('custom', 'flutter-ultra-devtools', 'panel_command', {
          waiting: true,
          prompt: args.prompt,
        }),
      );
    }
    const command = await panelServer.waitForCommand(args.timeoutMs, ctx.signal);
    return command;
  },
);

await server.start();
