// `interactive_elements` — enumerate tappable / text-input widgets.
//
// Rev-23 tightening (per task #9 spec + plan §5.3 line 566):
//   - No truncation by default (returns full list regardless of size).
//   - Optional `{ limit, offset }` for explicit pagination.
//   - Optional `sortBy` ('tree-order' (default) | 'reading-order' | 'bounds-y' | 'bounds-x').
//   - Filter spec: `{ kinds, hasKey, withinSubtree }` — kinds is a heuristic on
//     element.type matching common interactive widget names.
//   - Returns `{ total, items, truncated }` so the agent can detect partial.

import { z } from 'zod';
import { callUltraExtension } from '../extension.js';
import {
  FinderSchema,
  filterElements,
  InteractiveElementsResponseSchema,
  type InteractiveElement,
} from '../finder.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const SortBySchema = z
  .enum(['tree-order', 'reading-order', 'bounds-y', 'bounds-x'])
  .default('tree-order');

const KindSchema = z.enum(['button', 'textfield', 'link', 'tabbar', 'switch', 'checkbox']);

const InputSchema = SessionIdInput.extend({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().min(0).optional(),
  sortBy: SortBySchema,
  kinds: z.array(KindSchema).optional(),
  hasKey: z.boolean().optional(),
  withinSubtree: FinderSchema.optional(),
});

const KIND_TYPE_HEURISTICS: Record<z.infer<typeof KindSchema>, RegExp> = {
  button: /Button$|^GestureDetector$|^InkWell$|^InkResponse$/,
  textfield: /^TextField$|^TextFormField$|^CupertinoTextField$|^EditableText$/,
  link: /^Link$|^MouseRegion$/,
  tabbar: /^Tab$|^TabBar$/,
  switch: /^Switch$|^CupertinoSwitch$/,
  checkbox: /^Checkbox$|^CupertinoCheckbox$/,
};

function matchesKinds(element: InteractiveElement, kinds: z.infer<typeof KindSchema>[]): boolean {
  if (kinds.length === 0) return true;
  return kinds.some((k) => KIND_TYPE_HEURISTICS[k].test(element.type));
}

function sortElements(
  elements: InteractiveElement[],
  sortBy: z.infer<typeof SortBySchema>,
): InteractiveElement[] {
  switch (sortBy) {
    case 'tree-order':
      // Preserve the Dart-side traversal order verbatim.
      return elements;
    case 'reading-order':
      // Top-to-bottom, then left-to-right. Tolerate missing bounds by sinking them.
      return [...elements].sort((a, b) => {
        const ay = a.bounds?.y ?? Number.POSITIVE_INFINITY;
        const by = b.bounds?.y ?? Number.POSITIVE_INFINITY;
        if (ay !== by) return ay - by;
        const ax = a.bounds?.x ?? Number.POSITIVE_INFINITY;
        const bx = b.bounds?.x ?? Number.POSITIVE_INFINITY;
        return ax - bx;
      });
    case 'bounds-y':
      return [...elements].sort(
        (a, b) =>
          (a.bounds?.y ?? Number.POSITIVE_INFINITY) - (b.bounds?.y ?? Number.POSITIVE_INFINITY),
      );
    case 'bounds-x':
      return [...elements].sort(
        (a, b) =>
          (a.bounds?.x ?? Number.POSITIVE_INFINITY) - (b.bounds?.x ?? Number.POSITIVE_INFINITY),
      );
  }
}

export function interactiveElementsTool(
  registry: SessionRegistry,
): GestureTool<typeof InputSchema, z.ZodTypeAny> {
  return defineTool({
    name: 'interactive_elements',
    description:
      'Enumerate tappable / text-input widgets in the active Flutter app. ' +
      'Returns viewport-relative bounds, key, text, and type per element. ' +
      'Rev-23 contract: no truncation by default; opt-in pagination via `limit`/`offset`; ' +
      '`sortBy` default `tree-order`; `kinds`/`hasKey`/`withinSubtree` filters scope results.',
    inputSchema: InputSchema,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const raw = await callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.interactiveElements',
      );
      const parsed = InteractiveElementsResponseSchema.parse(raw);
      let elements = parsed.elements as InteractiveElement[];

      if (input.withinSubtree) {
        const ancestors = filterElements(elements, input.withinSubtree);
        if (ancestors.length === 0) {
          return { total: 0, items: [], truncated: false };
        }
        elements = elements.filter((e) =>
          ancestors.some((a) => containsBounds(a.bounds, e.bounds)),
        );
      }
      if (input.kinds && input.kinds.length > 0) {
        elements = elements.filter((e) => matchesKinds(e, input.kinds!));
      }
      if (input.hasKey === true) {
        elements = elements.filter((e) => typeof e.key === 'string' && e.key.length > 0);
      }

      const sorted = sortElements(elements, input.sortBy);

      const total = sorted.length;
      const offset = input.offset ?? 0;
      let items: InteractiveElement[];
      let truncated = false;
      if (input.limit === undefined) {
        items = offset > 0 ? sorted.slice(offset) : sorted;
      } else {
        items = sorted.slice(offset, offset + input.limit);
        truncated = offset + input.limit < total;
      }
      return { total, items, truncated };
    },
  });
}

function containsBounds(
  outer: InteractiveElement['bounds'],
  inner: InteractiveElement['bounds'],
): boolean {
  if (!outer || !inner) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
