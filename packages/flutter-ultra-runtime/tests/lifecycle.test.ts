// Tests for lifecycle tool schemas and registration.
//
// These tests verify:
//   - call_vm_service_method is registered with a non-empty description.
//   - Its input schema accepts valid inputs and rejects invalid ones.
//   - sessionId is required (min 8 chars).
//   - method is required.
//   - isolateId and params are optional.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRuntimeServer } from '../src/index.js';

type SafeParseResult = { success: boolean };
type SchemaLike = { safeParse: (v: unknown) => SafeParseResult };
type ToolEntry = { description: string; inputSchema?: SchemaLike };

function getSchema(
  registeredTools: Map<string, unknown>,
  toolName: string,
): SchemaLike | undefined {
  const tool = registeredTools.get(toolName) as ToolEntry | undefined;
  return tool?.inputSchema;
}

// ── Registration ──────────────────────────────────────────────────────────────

describe('call_vm_service_method registration', () => {
  let registeredTools: Map<string, unknown>;

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<string, Record<string, unknown>>;
    registeredTools = new Map(Object.entries(mcp['_registeredTools'] ?? {}));
  });

  it('is registered', () => {
    expect(registeredTools.has('call_vm_service_method')).toBe(true);
  });

  it('has a non-empty description', () => {
    const tool = registeredTools.get('call_vm_service_method') as ToolEntry | undefined;
    expect(tool?.description.length).toBeGreaterThan(0);
  });

  it('name matches [a-z][a-z0-9_]* pattern', () => {
    expect('call_vm_service_method').toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

// ── call_vm_service_method schema ─────────────────────────────────────────────

describe('call_vm_service_method schema', () => {
  let schema: SchemaLike | undefined;

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<string, Record<string, unknown>>;
    const registeredTools = new Map(Object.entries(mcp['_registeredTools'] ?? {}));
    schema = getSchema(registeredTools, 'call_vm_service_method');
  });

  it('accepts sessionId + method (minimal valid input)', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        method: 'getVM',
      }).success,
    ).toBe(true);
  });

  it('accepts all four fields', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        method: 'evaluate',
        isolateId: 'isolates/123456',
        params: { expression: '1 + 1', targetId: 'objects/5' },
      }).success,
    ).toBe(true);
  });

  it('accepts method with extension prefix', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        method: 'ext.flutter.inspector.getRootWidgetSummaryTree',
        isolateId: 'isolates/1',
        params: { objectGroup: 'tree' },
      }).success,
    ).toBe(true);
  });

  it('accepts params as empty object', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        method: 'getVM',
        params: {},
      }).success,
    ).toBe(true);
  });

  it('rejects missing method', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
      }).success,
    ).toBe(false);
  });

  it('rejects missing sessionId', () => {
    expect(
      schema?.safeParse({
        method: 'getVM',
      }).success,
    ).toBe(false);
  });

  it('rejects empty object', () => {
    expect(schema?.safeParse({}).success).toBe(false);
  });

  it('rejects sessionId shorter than 8 chars', () => {
    expect(
      schema?.safeParse({
        sessionId: 'short',
        method: 'getVM',
      }).success,
    ).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(schema?.safeParse(null).success).toBe(false);
    expect(schema?.safeParse('bad').success).toBe(false);
    expect(schema?.safeParse(42).success).toBe(false);
  });

  it('isolateId is optional — omitting it is valid', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        method: 'getStack',
      }).success,
    ).toBe(true);
  });

  it('params is optional — omitting it is valid', () => {
    expect(
      schema?.safeParse({
        sessionId: '00000000-0000-0000-0000-000000000001',
        method: 'getVM',
      }).success,
    ).toBe(true);
  });
});
