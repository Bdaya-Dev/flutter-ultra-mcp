// AC-G4 — rev-23 tightened contract for interactive_elements.
//
// Validates: no truncation by default, opt-in pagination, sortBy options,
// withinSubtree + kinds + hasKey filters, returns { total, items, truncated }.

import { describe, expect, it } from 'vitest';
import { interactiveElementsTool } from '../src/tools/interactive-elements.js';
import { z } from 'zod';

// Mock SessionRegistry: returns a fake VmServiceClient that responds to
// ext.flutter.ultra.interactiveElements with a fixed set of 300 elements.
function makeRegistry(elements: unknown[]) {
  const handle = {
    session: { id: 'x', uri: 'ws://test' },
    client: {
      callServiceExtension: async (_method: string) => ({
        type: '_extensionType',
        method: 'ext.flutter.ultra.interactiveElements',
        status: 'Success',
        elements,
      }),
    },
    isolateId: 'iso-1',
    ultraVersion: '0.0.1',
  };
  return {
    resolve: async () => handle,
  } as unknown as Parameters<typeof interactiveElementsTool>[0];
}

const sessionId = '11111111-1111-1111-1111-111111111111';

describe('interactive_elements rev-23 contract', () => {
  const baseElement = (i: number) => ({
    type: i % 3 === 0 ? 'TextField' : i % 3 === 1 ? 'ElevatedButton' : 'Container',
    key: i % 5 === 0 ? `elem-${i}` : undefined,
    text: `Label ${i}`,
    bounds: { x: 50, y: i * 20, width: 200, height: 18 },
    visible: true,
  });

  const elements = Array.from({ length: 300 }, (_, i) => baseElement(i));

  it('returns full list with no truncation by default', async () => {
    const tool = interactiveElementsTool(makeRegistry(elements));
    const out = await tool.handler({
      sessionId,
      sortBy: 'tree-order',
    } as z.infer<typeof tool.inputSchema>);
    const result = out as { total: number; items: unknown[]; truncated: boolean };
    expect(result.total).toBe(300);
    expect(result.items).toHaveLength(300);
    expect(result.truncated).toBe(false);
  });

  it('supports opt-in pagination with `limit` and `offset`', async () => {
    const tool = interactiveElementsTool(makeRegistry(elements));
    const page = await tool.handler({
      sessionId,
      sortBy: 'tree-order',
      limit: 50,
      offset: 100,
    } as z.infer<typeof tool.inputSchema>);
    const result = page as {
      total: number;
      items: unknown[];
      truncated: boolean;
    };
    expect(result.total).toBe(300);
    expect(result.items).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it('truncated=false when limit covers the tail', async () => {
    const tool = interactiveElementsTool(makeRegistry(elements));
    const page = await tool.handler({
      sessionId,
      sortBy: 'tree-order',
      limit: 100,
      offset: 250,
    } as z.infer<typeof tool.inputSchema>);
    const result = page as { truncated: boolean; items: unknown[] };
    expect(result.items).toHaveLength(50);
    expect(result.truncated).toBe(false);
  });

  it('default sortBy is tree-order — preserves Dart-side traversal', async () => {
    const tool = interactiveElementsTool(makeRegistry(elements));
    // Apply schema defaults the way the server's request handler does.
    const parsed = tool.inputSchema.parse({ sessionId }) as z.infer<typeof tool.inputSchema>;
    expect(parsed.sortBy).toBe('tree-order');
    const out = await tool.handler(parsed);
    const result = out as { items: { text: string }[] };
    expect(result.items[0]!.text).toBe('Label 0');
    expect(result.items[1]!.text).toBe('Label 1');
    expect(result.items[299]!.text).toBe('Label 299');
  });

  it('reading-order sorts by bounds.y then bounds.x', async () => {
    const tool = interactiveElementsTool(
      makeRegistry([
        { type: 'A', bounds: { x: 50, y: 200, width: 10, height: 10 } },
        { type: 'B', bounds: { x: 10, y: 50, width: 10, height: 10 } },
        { type: 'C', bounds: { x: 80, y: 50, width: 10, height: 10 } },
      ]),
    );
    const out = await tool.handler({
      sessionId,
      sortBy: 'reading-order',
    } as z.infer<typeof tool.inputSchema>);
    const result = out as { items: { type: string }[] };
    expect(result.items.map((i) => i.type)).toEqual(['B', 'C', 'A']);
  });

  it('kinds filter scopes to TextField when kind=textfield', async () => {
    const tool = interactiveElementsTool(makeRegistry(elements));
    const out = await tool.handler({
      sessionId,
      sortBy: 'tree-order',
      kinds: ['textfield'],
    } as z.infer<typeof tool.inputSchema>);
    const result = out as { total: number; items: { type: string }[] };
    expect(result.items.every((i) => i.type === 'TextField')).toBe(true);
    expect(result.total).toBe(100);
  });

  it('hasKey filter drops elements without a key', async () => {
    const tool = interactiveElementsTool(makeRegistry(elements));
    const out = await tool.handler({
      sessionId,
      sortBy: 'tree-order',
      hasKey: true,
    } as z.infer<typeof tool.inputSchema>);
    const result = out as { items: { key?: string }[] };
    expect(result.items.every((i) => typeof i.key === 'string')).toBe(true);
  });

  it('withinSubtree filter scopes results to ancestor bounds', async () => {
    const tool = interactiveElementsTool(
      makeRegistry([
        {
          type: 'Form',
          key: 'login-form',
          bounds: { x: 0, y: 0, width: 400, height: 600 },
        },
        {
          type: 'TextField',
          key: 'username',
          bounds: { x: 50, y: 100, width: 200, height: 40 },
        },
        {
          type: 'TextField',
          key: 'search',
          bounds: { x: 500, y: 50, width: 200, height: 40 },
        },
      ]),
    );
    const out = await tool.handler({
      sessionId,
      sortBy: 'tree-order',
      withinSubtree: { kind: 'key', value: 'login-form' },
      kinds: ['textfield'],
    } as z.infer<typeof tool.inputSchema>);
    const result = out as { total: number; items: { key: string }[] };
    expect(result.total).toBe(1);
    expect(result.items[0]!.key).toBe('username');
  });
});
