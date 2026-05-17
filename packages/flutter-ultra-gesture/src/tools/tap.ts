// `tap`, `double_tap`, `long_press` — gesture dispatch.
//
// Native finders (key/text=exact/type/coords/focused) pass through to
// `ext.flutter.ultra.tap`. Server-side finders (tooltip/semantics/descendant/
// text-contains/text-regex) are resolved to coordinates via
// `interactiveElements` first.

import { z } from 'zod';
import type { VmServiceClient } from '@flutter-ultra/vm-service-client';
import { callUltraExtension, stringifyArgs } from '../extension.js';
import {
  FinderSchema,
  InteractiveElementsResponseSchema,
  resolveFinderToCoords,
  toNativeMatcherJson,
  type FinderSpec,
  type InteractiveElement,
} from '../finder.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const TapInput = SessionIdInput.extend({ finder: FinderSchema });
const DoubleTapInput = SessionIdInput.extend({
  finder: FinderSchema,
  delayMs: z.number().int().positive().optional(),
});
const LongPressInput = SessionIdInput.extend({
  finder: FinderSchema,
  durationMs: z.number().int().positive().optional(),
});

async function resolveMatcherArgs(
  registry: SessionRegistry,
  sessionId: string,
  finder: FinderSpec,
): Promise<{
  matcher: Record<string, string>;
  isolateId: string;
  client: VmServiceClient;
}> {
  const handle = await registry.resolve(sessionId);
  const native = toNativeMatcherJson(finder);
  if (native !== null) {
    return { matcher: native, isolateId: handle.isolateId, client: handle.client };
  }
  // Server-side resolution via interactiveElements → coords.
  const raw = await callUltraExtension(
    handle.client,
    handle.isolateId,
    'ext.flutter.ultra.interactiveElements',
  );
  const parsed = InteractiveElementsResponseSchema.parse(raw);
  const coords = resolveFinderToCoords(parsed.elements as InteractiveElement[], finder);
  if (!coords) {
    throw new Error(
      `Finder did not match any element. Finder: ${JSON.stringify(finder)}. ` +
        `Use \`interactive_elements\` to inspect the current widget tree.`,
    );
  }
  return {
    matcher: { x: String(coords.x), y: String(coords.y) },
    isolateId: handle.isolateId,
    client: handle.client,
  };
}

export function tapTool(registry: SessionRegistry): GestureTool<typeof TapInput, z.ZodTypeAny> {
  return defineTool({
    name: 'tap',
    description:
      'Dispatch a tap on the widget matching `finder`. Native finders (key/text-exact/type/coords/focused) call ext.flutter.ultra.tap directly; server-side finders (tooltip/semantics/descendant/text-contains/text-regex) are resolved to coordinates via interactive_elements.',
    inputSchema: TapInput,
    handler: async (input) => {
      const { matcher, isolateId, client } = await resolveMatcherArgs(
        registry,
        input.sessionId,
        input.finder,
      );
      return callUltraExtension(client, isolateId, 'ext.flutter.ultra.tap', stringifyArgs(matcher));
    },
  });
}

export function doubleTapTool(
  registry: SessionRegistry,
): GestureTool<typeof DoubleTapInput, z.ZodTypeAny> {
  return defineTool({
    name: 'double_tap',
    description: 'Dispatch a double-tap. `delayMs` controls the inter-tap delay (default 100ms).',
    inputSchema: DoubleTapInput,
    handler: async (input) => {
      const { matcher, isolateId, client } = await resolveMatcherArgs(
        registry,
        input.sessionId,
        input.finder,
      );
      const args: Record<string, unknown> = { ...matcher };
      if (input.delayMs !== undefined) args.delay = input.delayMs;
      return callUltraExtension(
        client,
        isolateId,
        'ext.flutter.ultra.doubleTap',
        stringifyArgs(args),
      );
    },
  });
}

export function longPressTool(
  registry: SessionRegistry,
): GestureTool<typeof LongPressInput, z.ZodTypeAny> {
  return defineTool({
    name: 'long_press',
    description: 'Dispatch a long press. `durationMs` controls press duration (default 600ms).',
    inputSchema: LongPressInput,
    handler: async (input) => {
      const { matcher, isolateId, client } = await resolveMatcherArgs(
        registry,
        input.sessionId,
        input.finder,
      );
      const args: Record<string, unknown> = { ...matcher };
      if (input.durationMs !== undefined) args.duration = input.durationMs;
      return callUltraExtension(
        client,
        isolateId,
        'ext.flutter.ultra.longPress',
        stringifyArgs(args),
      );
    },
  });
}
