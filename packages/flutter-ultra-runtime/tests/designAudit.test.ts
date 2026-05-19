// Tests for design audit tool schemas and registration.
//
// These tests verify:
//   - Each tool has a correct name and non-empty description.
//   - Input schemas accept valid inputs and reject invalid ones.
//   - All design audit tools are registered in the runtime server.
//   - CHECKS enum values are correct.
//   - Default checks behaviour (all enabled when omitted).

import { describe, it, expect, beforeAll } from 'vitest';
import { createRuntimeServer } from '../src/index.js';
import { CHECKS } from '../src/tools/designAudit.js';

const DESIGN_TOOL_NAMES = [
  'audit_design',
  'extract_design_tokens',
  'audit_responsive',
  'extract_component_inventory',
];

// ── Registration ──────────────────────────────────────────────────────────────

describe('design audit tools registration', () => {
  let registeredTools: Map<string, { description: string; inputSchema: unknown }>;

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<
      string,
      Record<string, { description: string; inputSchema: unknown }>
    >;
    registeredTools = new Map(Object.entries(mcp['_registeredTools'] ?? {}));
  });

  it('registers all 3 design audit tools', () => {
    for (const name of DESIGN_TOOL_NAMES) {
      expect(registeredTools.has(name), `Missing tool: ${name}`).toBe(true);
    }
  });

  for (const name of DESIGN_TOOL_NAMES) {
    describe(`tool: ${name}`, () => {
      it('has a non-empty description', () => {
        const tool = registeredTools?.get(name);
        if (!tool) return;
        expect(tool.description.length).toBeGreaterThan(0);
      });

      it('name matches [a-z][a-z0-9_]* pattern', () => {
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      });
    });
  }
});

// ── CHECKS enum ───────────────────────────────────────────────────────────────

describe('CHECKS enum', () => {
  it('exports exactly 10 check ids', () => {
    expect(CHECKS.length).toBe(10);
  });

  it('contains touch_targets', () => {
    expect(CHECKS).toContain('touch_targets');
  });

  it('contains missing_semantics', () => {
    expect(CHECKS).toContain('missing_semantics');
  });

  it('contains text_overflow', () => {
    expect(CHECKS).toContain('text_overflow');
  });

  it('contains layout_overflow', () => {
    expect(CHECKS).toContain('layout_overflow');
  });

  it('contains hardcoded_color', () => {
    expect(CHECKS).toContain('hardcoded_color');
  });

  it('contains hardcoded_text_style', () => {
    expect(CHECKS).toContain('hardcoded_text_style');
  });

  it('contains inconsistent_spacing', () => {
    expect(CHECKS).toContain('inconsistent_spacing');
  });

  it('contains nested_cards', () => {
    expect(CHECKS).toContain('nested_cards');
  });

  it('contains everything_centered', () => {
    expect(CHECKS).toContain('everything_centered');
  });

  it('contains tiny_text', () => {
    expect(CHECKS).toContain('tiny_text');
  });

  it('contains no duplicates', () => {
    const unique = new Set(CHECKS);
    expect(unique.size).toBe(CHECKS.length);
  });
});

// ── audit_design schema ───────────────────────────────────────────────────────

describe('audit_design schema', () => {
  let schema: { safeParse: (v: unknown) => { success: boolean } } | undefined;

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<
      string,
      Record<string, { inputSchema?: { safeParse: (v: unknown) => { success: boolean } } }>
    >;
    schema = (mcp['_registeredTools'] as Record<string, unknown>)['audit_design'] as
      | { inputSchema?: { safeParse: (v: unknown) => { success: boolean } } }
      | undefined;
    schema = (schema as unknown as { inputSchema?: typeof schema })?.inputSchema ?? schema;
  });

  it('accepts sessionId only (defaults checks to all)', () => {
    expect(schema?.safeParse({ sessionId: '00000000-0000-0000-0000-000000000001' }).success).toBe(
      true,
    );
  });

  it('accepts sessionId with explicit checks array', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        checks: ['touch_targets', 'tiny_text'],
      }).success,
    ).toBe(true);
  });

  it('accepts empty checks array', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        checks: [],
      }).success,
    ).toBe(true);
  });

  it('rejects unknown check id', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        checks: ['nonexistent_check'],
      }).success,
    ).toBe(false);
  });

  it('rejects missing sessionId', () => {
    expect(schema?.safeParse({}).success).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(schema?.safeParse('bad').success).toBe(false);
    expect(schema?.safeParse(null).success).toBe(false);
    expect(schema?.safeParse(42).success).toBe(false);
  });
});

// ── extract_design_tokens schema ──────────────────────────────────────────────

describe('extract_design_tokens schema', () => {
  let schema: { safeParse: (v: unknown) => { success: boolean } } | undefined;

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<string, Record<string, unknown>>;
    const tool = (mcp['_registeredTools'] as Record<string, unknown>)['extract_design_tokens'] as
      | { inputSchema?: { safeParse: (v: unknown) => { success: boolean } } }
      | undefined;
    schema = tool?.inputSchema;
  });

  it('accepts valid sessionId', () => {
    expect(schema?.safeParse({ sessionId: '00000000-0000-0000-0000-000000000001' }).success).toBe(
      true,
    );
  });

  it('rejects missing sessionId', () => {
    expect(schema?.safeParse({}).success).toBe(false);
  });

  it('rejects non-object input (extract_design_tokens)', () => {
    expect(schema?.safeParse(null).success).toBe(false);
    expect(schema?.safeParse('bad').success).toBe(false);
  });
});

// ── audit_responsive schema ───────────────────────────────────────────────────

describe('audit_responsive schema', () => {
  let schema: { safeParse: (v: unknown) => { success: boolean } } | undefined;

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<string, Record<string, unknown>>;
    const tool = (mcp['_registeredTools'] as Record<string, unknown>)['audit_responsive'] as
      | { inputSchema?: { safeParse: (v: unknown) => { success: boolean } } }
      | undefined;
    schema = tool?.inputSchema;
  });

  it('accepts sessionId only (uses default viewports)', () => {
    expect(schema?.safeParse({ sessionId: '00000000-0000-0000-0000-000000000001' }).success).toBe(
      true,
    );
  });

  it('accepts custom viewports array', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        viewports: [
          { width: 375, height: 667, label: 'compact' },
          { width: 1440, height: 900, label: 'large' },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts viewports with checks', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        viewports: [{ width: 768, height: 1024, label: 'tablet' }],
        checks: ['touch_targets', 'layout_overflow'],
      }).success,
    ).toBe(true);
  });

  it('rejects viewport with negative width', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        viewports: [{ width: -1, height: 667, label: 'bad' }],
      }).success,
    ).toBe(false);
  });

  it('rejects viewport with empty label', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        viewports: [{ width: 375, height: 667, label: '' }],
      }).success,
    ).toBe(false);
  });

  it('rejects missing sessionId', () => {
    expect(schema?.safeParse({}).success).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(schema?.safeParse(null).success).toBe(false);
    expect(schema?.safeParse('bad').success).toBe(false);
  });
});

// ── extract_component_inventory schema ────────────────────────────────────────

describe('extract_component_inventory schema', () => {
  let schema: { safeParse: (v: unknown) => { success: boolean } } | undefined;

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<string, Record<string, unknown>>;
    const tool = (mcp['_registeredTools'] as Record<string, unknown>)[
      'extract_component_inventory'
    ] as { inputSchema?: { safeParse: (v: unknown) => { success: boolean } } } | undefined;
    schema = tool?.inputSchema;
  });

  it('accepts valid sessionId (empty-input form)', () => {
    expect(schema?.safeParse({ sessionId: '00000000-0000-0000-0000-000000000001' }).success).toBe(
      true,
    );
  });

  it('rejects missing sessionId', () => {
    expect(schema?.safeParse({}).success).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(schema?.safeParse(null).success).toBe(false);
    expect(schema?.safeParse('bad').success).toBe(false);
    expect(schema?.safeParse(42).success).toBe(false);
  });
});

// ── extract_component_inventory registration ──────────────────────────────────

describe('extract_component_inventory registration', () => {
  it('has correct tool name pattern', () => {
    expect('extract_component_inventory').toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('is registered with non-empty description', async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<
      string,
      Record<string, { description: string; inputSchema: unknown }>
    >;
    const registeredTools = new Map(Object.entries(mcp['_registeredTools'] ?? {}));
    const tool = registeredTools.get('extract_component_inventory');
    expect(tool, 'extract_component_inventory not registered').toBeDefined();
    expect(tool!.description.length).toBeGreaterThan(0);
  });
});
