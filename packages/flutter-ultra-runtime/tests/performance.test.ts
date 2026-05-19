// Tests for performance tool schemas and registration.
//
// These tests verify:
//   - Each tool has a correct name and non-empty description.
//   - Input schemas accept valid inputs and reject invalid ones.
//   - All performance tools are registered in the runtime server.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRuntimeServer } from '../src/index.js';

const PERF_TOOL_NAMES = [
  'get_memory_usage',
  'get_allocation_profile',
  'start_cpu_profile',
  'get_cpu_samples',
  'stop_cpu_profile',
  'start_frame_tracking',
  'get_frame_timing',
  'stop_frame_tracking',
  'start_rebuild_tracking',
  'get_rebuild_stats',
  'stop_rebuild_tracking',
  'get_startup_timing',
];

describe('performance tools registration', () => {
  let registeredTools: Map<string, { description: string; inputSchema: unknown }>;

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<
      string,
      Record<string, { description: string; inputSchema: unknown }>
    >;
    registeredTools = new Map(Object.entries(mcp['_registeredTools'] ?? {}));
  });

  it('registers all 12 performance tools', () => {
    for (const name of PERF_TOOL_NAMES) {
      expect(registeredTools.has(name), `Missing tool: ${name}`).toBe(true);
    }
  });

  for (const name of PERF_TOOL_NAMES) {
    describe(`tool: ${name}`, () => {
      it('has a non-empty description', () => {
        // description is checked after beforeAll runs; wrap in getter
        const tool = registeredTools?.get(name);
        if (!tool) return; // covered by registration test above
        expect(tool.description.length).toBeGreaterThan(0);
      });
    });
  }
});

describe('get_memory_usage schema', () => {
  it('accepts valid sessionId', async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<
      string,
      Record<string, { inputSchema?: { safeParse: (v: unknown) => { success: boolean } } }>
    >;
    const tool = (mcp['_registeredTools'] as Record<string, unknown>)['get_memory_usage'] as {
      inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
    };
    const schema = tool?.inputSchema;
    if (!schema) return;
    expect(schema.safeParse({ sessionId: '00000000-0000-0000-0000-000000000001' }).success).toBe(
      true,
    );
    // Missing sessionId → should fail
    expect(schema.safeParse({}).success).toBe(false);
    // Non-object → should fail
    expect(schema.safeParse('bad').success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });
});

describe('get_allocation_profile schema', () => {
  it('accepts gc and reset flags', async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<
      string,
      Record<string, { inputSchema?: { safeParse: (v: unknown) => { success: boolean } } }>
    >;
    const tool = (mcp['_registeredTools'] as Record<string, unknown>)['get_allocation_profile'] as {
      inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
    };
    const schema = tool?.inputSchema;
    if (!schema) return;
    expect(
      schema.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        gc: true,
        reset: false,
      }).success,
    ).toBe(true);
    // Defaults work — no gc/reset required
    expect(schema.safeParse({ sessionId: '00000000-0000-0000-0000-000000000001' }).success).toBe(
      true,
    );
  });
});

describe('get_cpu_samples schema', () => {
  it('accepts optional timeOriginMicros and timeExtentMicros', async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<
      string,
      Record<string, { inputSchema?: { safeParse: (v: unknown) => { success: boolean } } }>
    >;
    const tool = (mcp['_registeredTools'] as Record<string, unknown>)['get_cpu_samples'] as {
      inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
    };
    const schema = tool?.inputSchema;
    if (!schema) return;
    expect(
      schema.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        timeOriginMicros: 0,
        timeExtentMicros: 5_000_000,
      }).success,
    ).toBe(true);
    // negative timeExtentMicros → should fail
    expect(
      schema.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        timeExtentMicros: -1,
      }).success,
    ).toBe(false);
  });
});

describe('start_frame_tracking schema', () => {
  it('accepts profilePaints and profileLayouts', async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<
      string,
      Record<string, { inputSchema?: { safeParse: (v: unknown) => { success: boolean } } }>
    >;
    const tool = (mcp['_registeredTools'] as Record<string, unknown>)['start_frame_tracking'] as {
      inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
    };
    const schema = tool?.inputSchema;
    if (!schema) return;
    expect(
      schema.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        profilePaints: true,
        profileLayouts: true,
      }).success,
    ).toBe(true);
  });
});
