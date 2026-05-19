// AC-G2: wait_for returns immediately if visible, polls every 200ms otherwise.

import { describe, expect, it } from 'vitest';
import { waitForTool } from '../src/tools/wait-for.js';
import type { z } from 'zod';

const sessionId = '22222222-2222-2222-2222-222222222222';

function makeRegistry(elementsPerCall: unknown[][]): {
  registry: Parameters<typeof waitForTool>[0];
  calls: { count: number };
} {
  const calls = { count: 0 };
  const handle = {
    session: { id: sessionId, uri: 'ws://test' },
    client: {
      callServiceExtension: async () => {
        const elements = elementsPerCall[Math.min(calls.count, elementsPerCall.length - 1)];
        calls.count += 1;
        return {
          type: '_extensionType',
          method: 'ext.flutter.ultra.interactiveElements',
          status: 'Success',
          elements,
        };
      },
    },
    isolateId: 'iso-1',
    ultraVersion: '0.0.1',
  };
  return {
    registry: { resolve: async () => handle } as unknown as Parameters<typeof waitForTool>[0],
    calls,
  };
}

describe('wait_for', () => {
  it('returns immediately on first poll when element already visible (AC-G2)', async () => {
    const { registry, calls } = makeRegistry([
      [
        {
          type: 'ElevatedButton',
          key: 'login_button',
          bounds: { x: 50, y: 100, width: 100, height: 40 },
          visible: true,
        },
      ],
    ]);
    const tool = waitForTool(registry);
    const start = Date.now();
    const result = (await tool.handler({
      sessionId,
      finder: { kind: 'key', value: 'login_button' },
      timeoutMs: 10_000,
      pollIntervalMs: 200,
      requireVisible: true,
    } as z.infer<typeof tool.inputSchema>)) as { found: boolean; attempts: number };
    expect(result.found).toBe(true);
    expect(result.attempts).toBe(1);
    expect(calls.count).toBe(1);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('polls until visible after N attempts', async () => {
    const visibleBtn = {
      type: 'ElevatedButton',
      key: 'login_button',
      bounds: { x: 50, y: 100, width: 100, height: 40 },
      visible: true,
    };
    const { registry, calls } = makeRegistry([
      [], // first poll: empty tree
      [], // second poll: still empty
      [visibleBtn], // third poll: visible
    ]);
    const tool = waitForTool(registry);
    const result = (await tool.handler({
      sessionId,
      finder: { kind: 'key', value: 'login_button' },
      timeoutMs: 2_000,
      pollIntervalMs: 50, // shorten for test
      requireVisible: true,
    } as z.infer<typeof tool.inputSchema>)) as { found: boolean; attempts: number };
    expect(result.found).toBe(true);
    expect(result.attempts).toBe(3);
    expect(calls.count).toBe(3);
  });

  it('rejects on timeout', async () => {
    const { registry } = makeRegistry([[]]);
    const tool = waitForTool(registry);
    await expect(
      tool.handler({
        sessionId,
        finder: { kind: 'key', value: 'never' },
        timeoutMs: 100,
        pollIntervalMs: 30,
        requireVisible: true,
      } as z.infer<typeof tool.inputSchema>),
    ).rejects.toThrow(/timed out/);
  });
});
