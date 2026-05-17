// `scroll_to` and `scroll_until_visible`.
//
// `scroll_to` delegates directly to `ext.flutter.ultra.scrollTo`.
// `scroll_until_visible` is server-side: it loops `scrollTo` + visibility check
// from `interactiveElements` (the bool `visible` field) until success or
// timeout. The Dart side has no built-in until-visible primitive yet.

import { z } from 'zod';
import { callUltraExtension, stringifyArgs } from '../extension.js';
import {
  FinderSchema,
  InteractiveElementsResponseSchema,
  filterElements,
  toNativeMatcherJson,
  type InteractiveElement,
} from '../finder.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const ScrollToInput = SessionIdInput.extend({ finder: FinderSchema });

const ScrollUntilVisibleInput = SessionIdInput.extend({
  finder: FinderSchema,
  timeoutMs: z.number().int().positive().default(10_000),
  pollIntervalMs: z.number().int().positive().default(200),
  maxScrolls: z.number().int().positive().default(20),
});

export function scrollToTool(
  registry: SessionRegistry,
): GestureTool<typeof ScrollToInput, z.ZodTypeAny> {
  return defineTool({
    name: 'scroll_to',
    description: 'Scroll the nearest Scrollable until the widget matching `finder` is visible.',
    inputSchema: ScrollToInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const native = toNativeMatcherJson(input.finder);
      if (native === null) {
        throw new Error(
          'scroll_to only supports native finders. ' + `Got finder kind '${input.finder.kind}'.`,
        );
      }
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.scrollTo',
        stringifyArgs(native),
      );
    },
  });
}

export function scrollUntilVisibleTool(
  registry: SessionRegistry,
): GestureTool<typeof ScrollUntilVisibleInput, z.ZodTypeAny> {
  return defineTool({
    name: 'scroll_until_visible',
    description:
      'Repeatedly invoke scroll_to and probe interactive_elements until the widget is visible. Stops at `timeoutMs` (default 10s) or `maxScrolls` (default 20).',
    inputSchema: ScrollUntilVisibleInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const native = toNativeMatcherJson(input.finder);
      if (native === null) {
        throw new Error(
          'scroll_until_visible currently requires a native finder. ' +
            `Got '${input.finder.kind}'.`,
        );
      }
      const deadline = Date.now() + input.timeoutMs;
      let attempts = 0;
      while (attempts < input.maxScrolls && Date.now() < deadline) {
        // Probe visibility first.
        const probe = await callUltraExtension(
          handle.client,
          handle.isolateId,
          'ext.flutter.ultra.interactiveElements',
        );
        const parsed = InteractiveElementsResponseSchema.parse(probe);
        const matches = filterElements(parsed.elements as InteractiveElement[], input.finder);
        const visibleHit = matches.find((m) => m.visible === true);
        if (visibleHit) {
          return {
            visible: true,
            attempts,
            element: visibleHit,
          };
        }
        await callUltraExtension(
          handle.client,
          handle.isolateId,
          'ext.flutter.ultra.scrollTo',
          stringifyArgs(native),
        );
        attempts += 1;
        await new Promise((r) => setTimeout(r, input.pollIntervalMs));
      }
      throw new Error(
        `scroll_until_visible did not find a visible match within ${input.timeoutMs}ms / ${input.maxScrolls} scrolls. ` +
          `Finder: ${JSON.stringify(input.finder)}.`,
      );
    },
  });
}
