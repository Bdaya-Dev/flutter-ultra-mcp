// `wait_for` — server-side polling primitive.
//
// AC-G2: wait_for(key='login_button', timeout=10s) returns immediately if
// visible, polls every 200ms otherwise. Uses interactive_elements as the
// ground-truth source (matches widget tree state, not a snapshot).

import { z } from 'zod';
import { callUltraExtension } from '../extension.js';
import {
  FinderSchema,
  InteractiveElementsResponseSchema,
  filterElements,
  type InteractiveElement,
} from '../finder.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const Input = SessionIdInput.extend({
  finder: FinderSchema,
  timeoutMs: z.number().int().positive().default(10_000),
  pollIntervalMs: z.number().int().positive().default(200),
  // Wait specifically for visibility instead of any match (defaults true).
  requireVisible: z.boolean().default(true),
});

export function waitForTool(registry: SessionRegistry): GestureTool<typeof Input, z.ZodTypeAny> {
  return defineTool({
    name: 'wait_for',
    description:
      'Block until a widget matching `finder` exists (and is visible, if requireVisible). Polls interactive_elements every `pollIntervalMs` (default 200ms) up to `timeoutMs` (default 10s).',
    inputSchema: Input,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const deadline = Date.now() + input.timeoutMs;
      let attempts = 0;
      let lastTotal = 0;
      while (Date.now() < deadline) {
        attempts += 1;
        const raw = await callUltraExtension(
          handle.client,
          handle.isolateId,
          'ext.flutter.ultra.interactiveElements',
        );
        const parsed = InteractiveElementsResponseSchema.parse(raw);
        const elements = parsed.elements as InteractiveElement[];
        lastTotal = elements.length;
        const matches = filterElements(elements, input.finder);
        const hit = input.requireVisible ? matches.find((m) => m.visible === true) : matches[0];
        if (hit) {
          return {
            found: true,
            attempts,
            element: hit,
          };
        }
        await new Promise((r) => setTimeout(r, input.pollIntervalMs));
      }
      throw new Error(
        `wait_for timed out after ${input.timeoutMs}ms (attempts=${attempts}, lastTreeSize=${lastTotal}). ` +
          `Finder: ${JSON.stringify(input.finder)}.`,
      );
    },
  });
}
