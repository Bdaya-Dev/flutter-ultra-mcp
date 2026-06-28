// Regression guard for the MCP `inputSchema` contract: every tool's top-level
// inputSchema MUST be an object schema (`type: "object"`). A top-level union —
// e.g. swipe's coordinate-vs-element form — previously serialised to a bare
// `{ anyOf: [...] }` with no top-level `type`, which Claude Code rejects with
// `Invalid input: expected "object"` and the whole server's tool list fails to
// load.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { allTools } from '../src/tools/index.js';
import { toInputJsonSchema } from '../src/json-schema.js';
import { SessionRegistry } from '../src/session.js';

describe('tool inputSchema MCP contract', () => {
  it('every registered tool advertises an object inputSchema', () => {
    const tools = allTools(new SessionRegistry());
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.inputJsonSchema.type, `${tool.name} inputSchema.type`).toBe('object');
    }
  });

  it('swipe (top-level union) keeps its branches under an object root', () => {
    const swipe = allTools(new SessionRegistry()).find((t) => t.name === 'swipe');
    expect(swipe).toBeDefined();
    expect(swipe!.inputJsonSchema.type).toBe('object');
    // Union branches preserved so a valid instance must still match one form.
    expect(swipe!.inputJsonSchema.anyOf).toHaveLength(2);
  });
});

describe('toInputJsonSchema', () => {
  it('wraps a top-level union as an object schema with anyOf preserved', () => {
    const schema = z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]);
    const json = toInputJsonSchema(schema);
    expect(json.type).toBe('object');
    expect(json.anyOf).toHaveLength(2);
  });

  it('wraps a top-level discriminated union as an object schema with oneOf preserved', () => {
    const schema = z.discriminatedUnion('k', [
      z.object({ k: z.literal('a'), a: z.string() }),
      z.object({ k: z.literal('b'), b: z.number() }),
    ]);
    const json = toInputJsonSchema(schema);
    expect(json.type).toBe('object');
    expect(json.oneOf).toHaveLength(2);
  });

  it('produces { type: "object", properties: {} } for a no-arg / rootless schema', () => {
    const json = toInputJsonSchema(z.unknown());
    expect(json.type).toBe('object');
    expect(json.properties).toEqual({});
  });

  it('passes an ordinary object schema through unchanged', () => {
    const json = toInputJsonSchema(z.object({ a: z.string() }));
    expect(json.type).toBe('object');
    expect(json.properties).toHaveProperty('a');
  });
});
