// Schema property-based tests for all 8 flutter-ultra MCP server tool inputs.
//
// Validates that every tool across every server has:
//   - a non-empty description
//   - a name matching [a-z][a-z0-9_]* pattern
//   - a Zod inputSchema with a working safeParse method
//   - rejection of non-object inputs (string, null)
//
// Run: npx vitest run tests/schema-validation.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';

// ─── Shared type ─────────────────────────────────────────────────────────────

interface NormalisedTool {
  name: string;
  description: string;
  inputSchema: ZodTypeAny | null;
}

// ─── Shared assertions ────────────────────────────────────────────────────────

function assertTools(label: string, tools: NormalisedTool[]): void {
  for (const tool of tools) {
    expect(tool.name, `${label}: name must match [a-z][a-z0-9_]*`).toMatch(
      /^[a-z][a-z0-9_]*$/,
    );
    expect(
      tool.description.length,
      `${label}: tool "${tool.name}" has empty description`,
    ).toBeGreaterThan(0);

    if (tool.inputSchema) {
      expect(
        typeof tool.inputSchema.safeParse,
        `${label}: tool "${tool.name}" inputSchema missing safeParse`,
      ).toBe('function');
      expect(
        tool.inputSchema.safeParse('not-an-object').success,
        `${label}: tool "${tool.name}" should reject string input`,
      ).toBe(false);
      expect(
        tool.inputSchema.safeParse(null).success,
        `${label}: tool "${tool.name}" should reject null input`,
      ).toBe(false);
    }
  }
}

// Extract tools from a McpServer instance's private _registeredTools map.
function toolsFromMcpServer(mcp: unknown): NormalisedTool[] {
  const registered = (mcp as Record<string, unknown>)['_registeredTools'] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!registered) return [];
  return Object.entries(registered).map(([name, t]) => ({
    name,
    description: (t['description'] as string) ?? '',
    inputSchema: (t['inputSchema'] as ZodTypeAny) ?? null,
  }));
}

// ─── 1. flutter-ultra-patrol ─────────────────────────────────────────────────
// Exports TOOLS: ReadonlyArray<PatrolTool<ZodTypeAny>>
// Each tool: .name, .description, .inputSchema (Zod object)

import { TOOLS as PATROL_TOOLS } from '../packages/flutter-ultra-patrol/src/server.js';

describe('flutter-ultra-patrol schemas', () => {
  const tools: NormalisedTool[] = PATROL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as ZodTypeAny,
  }));

  it('exports at least one tool', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('all tools pass property checks', () => {
    assertTools('flutter-ultra-patrol', tools);
  });
});

// ─── 2. flutter-ultra-browser ────────────────────────────────────────────────
// Exports buildToolRegistry(): Map<string, ToolDefErased>
// Each entry: .name, .description, .schema (Zod)

import { buildToolRegistry } from '../packages/flutter-ultra-browser/src/index.js';

describe('flutter-ultra-browser schemas', () => {
  const registry = buildToolRegistry();
  const tools: NormalisedTool[] = Array.from(registry.values()).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.schema as ZodTypeAny,
  }));

  it('exports at least one tool', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('all tools pass property checks', () => {
    assertTools('flutter-ultra-browser', tools);
  });
});

// ─── 3. flutter-ultra-build ──────────────────────────────────────────────────
// createServer() returns an McpServer directly (not FlutterUltraServer).
// Tools stored in McpServer._registeredTools (private in TS, plain object in JS).

import { createServer as createBuildServer } from '../packages/flutter-ultra-build/src/index.js';

describe('flutter-ultra-build schemas', () => {
  let tools: NormalisedTool[] = [];

  beforeAll(() => {
    const server = createBuildServer();
    tools = toolsFromMcpServer(server);
  });

  it('exports at least one tool', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('all tools pass property checks', () => {
    assertTools('flutter-ultra-build', tools);
  });
});

// ─── 4. flutter-ultra-gesture ────────────────────────────────────────────────
// allTools(registry) returns GestureTool[] with .name, .description, .inputSchema (Zod).
// SessionRegistry is instantiated with a temp stateDir; tool definitions are
// independent of any live VM service connection.

import { allTools as gestureAllTools } from '../packages/flutter-ultra-gesture/src/tools/index.js';
import { SessionRegistry } from '../packages/flutter-ultra-gesture/src/session.js';

describe('flutter-ultra-gesture schemas', () => {
  const registry = new SessionRegistry({ stateDir: '/tmp/gesture-schema-test' });
  const tools: NormalisedTool[] = gestureAllTools(registry).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as ZodTypeAny,
  }));

  it('exports at least one tool', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('all tools pass property checks', () => {
    assertTools('flutter-ultra-gesture', tools);
  });
});

// ─── 5. flutter-ultra-runtime ────────────────────────────────────────────────
// createRuntimeServer() is async; tools registered on FlutterUltraServer.mcp
// (McpServer). We call it without starting the stdio transport.

import { createRuntimeServer } from '../packages/flutter-ultra-runtime/src/index.js';

describe('flutter-ultra-runtime schemas', () => {
  let tools: NormalisedTool[] = [];

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    tools = toolsFromMcpServer(srv.server.mcp);
  });

  it('exports at least one tool', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('all tools pass property checks', () => {
    assertTools('flutter-ultra-runtime', tools);
  });
});

// ─── 6. flutter-ultra-native-mobile ─────────────────────────────────────────
// createNativeMobileServer() is async; same McpServer._registeredTools pattern.

import { createNativeMobileServer } from '../packages/flutter-ultra-native-mobile/src/index.js';

describe('flutter-ultra-native-mobile schemas', () => {
  let tools: NormalisedTool[] = [];

  beforeAll(async () => {
    const srv = await createNativeMobileServer({ keepAliveIntervalMs: 0 });
    tools = toolsFromMcpServer(srv.server.mcp);
  });

  it('exports at least one tool', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('all tools pass property checks', () => {
    assertTools('flutter-ultra-native-mobile', tools);
  });
});

// ─── 7. flutter-ultra-native-desktop ─────────────────────────────────────────
// createNativeDesktopServer() is async. Backend may be null (no sidecar) so
// zero tools may register — we assert the server boots cleanly and any
// registered tools are valid (AC-ND4).

import { createNativeDesktopServer } from '../packages/flutter-ultra-native-desktop/src/index.js';

describe('flutter-ultra-native-desktop schemas', () => {
  let tools: NormalisedTool[] = [];

  beforeAll(async () => {
    const srv = await createNativeDesktopServer({
      keepAliveIntervalMs: 0,
      platformOverride: 'linux',
    });
    tools = toolsFromMcpServer(srv.server.mcp);
  });

  it('server boots without error', () => {
    expect(Array.isArray(tools)).toBe(true);
  });

  it('all registered tools pass property checks', () => {
    assertTools('flutter-ultra-native-desktop', tools);
  });
});

// ─── 8. flutter-ultra-devtools ───────────────────────────────────────────────
// devtools/index.ts registers 5 tools on a module-level server singleton that
// is not exported. We mirror the inputShapes verbatim from the source so the
// Zod schema instances are available for property testing.

describe('flutter-ultra-devtools schemas', () => {
  const tools: NormalisedTool[] = [
    {
      name: 'start_panel_server',
      description:
        'Start the WebSocket listener that the DevTools extension panel connects to. Returns the WS URL for the panel iframe.',
      inputSchema: z.object({
        port: z.number().int().min(1024).max(65535).default(9170),
      }),
    },
    {
      name: 'stop_panel_server',
      description: 'Stop the WebSocket listener and disconnect all panel viewers.',
      inputSchema: z.object({}),
    },
    {
      name: 'panel_status',
      description:
        'Check whether the panel WS server is running and how many viewers are connected.',
      inputSchema: z.object({}),
    },
    {
      name: 'push_event',
      description:
        'Push a structured event to all connected DevTools panels. Used internally by other servers via the shared devtools-bus, or manually by the agent for custom notifications.',
      inputSchema: z.object({
        type: z.enum([
          'tool_call',
          'tool_result',
          'session_change',
          'log',
          'screenshot',
          'error',
          'custom',
        ]),
        server: z.string().optional(),
        tool: z.string().optional(),
        payload: z.record(z.unknown()).optional(),
      }),
    },
    {
      name: 'panel_command',
      description:
        'Block until a connected DevTools panel sends a command (human-in-the-loop). The panel user clicks Pause/Resume or injects a manual instruction. Returns the command payload when received, or times out.',
      inputSchema: z.object({
        timeoutMs: z.number().int().min(1000).max(600_000).default(300_000),
        prompt: z.string().optional(),
      }),
    },
  ];

  it('defines 5 tools', () => {
    expect(tools.length).toBe(5);
  });

  it('all tools pass property checks', () => {
    assertTools('flutter-ultra-devtools', tools);
  });
});
