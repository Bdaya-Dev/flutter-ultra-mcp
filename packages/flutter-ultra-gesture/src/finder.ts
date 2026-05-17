// FinderSpec — typed JSON union for locating widgets in a Flutter app.
//
// Native finders (key/text/type/coords/focused) translate directly into the
// matcher JSON accepted by `ext.flutter.ultra.tap` etc. (see
// dart/ultra_flutter/lib/src/services/widget_matcher.dart for the wire format).
//
// Server-side finders (tooltip/semantics/descendant) cannot be expressed in
// the Dart matcher today; they're resolved here by:
//   1. Calling `ext.flutter.ultra.interactiveElements` to get the full list.
//   2. Filtering down to candidates.
//   3. Returning the first hit's bounds, which the caller hands to
//      `ext.flutter.ultra.<gesture>` as `{x, y}` coords.
//
// Worker-E publishes a compatible FinderSchema in @flutter-ultra/mcp-runtime
// (per coordination message). Once that lands as a shared package, this file
// will become a re-export.

import { z } from 'zod';

export const StringMatchTypeSchema = z.enum(['exact', 'contains', 'regex']).default('exact');

// Use lazy on the recursive variant only — top-level discriminatedUnion needs
// concrete entries.
const baseFinderShapes = [
  z.object({ kind: z.literal('key'), value: z.string() }),
  z.object({
    kind: z.literal('text'),
    value: z.string(),
    matchType: StringMatchTypeSchema,
  }),
  z.object({ kind: z.literal('type'), value: z.string() }),
  z.object({ kind: z.literal('coords'), x: z.number(), y: z.number() }),
  z.object({ kind: z.literal('focused') }),
  z.object({ kind: z.literal('tooltip'), value: z.string() }),
  z.object({
    kind: z.literal('semantics'),
    label: z.string(),
    matchType: z.enum(['exact', 'contains']).default('exact'),
  }),
] as const;

export const NativeFinderSchema = z.discriminatedUnion('kind', [...baseFinderShapes]);
export type NativeFinderSpec = z.infer<typeof NativeFinderSchema>;

// Recursive finder type — `descendant` references FinderSpec on both sides.
// Declared as a sibling interface so Zod's inferred type lines up after
// `.default()` chains apply (input/output divergence on `text.matchType`).
export interface DescendantFinderSpec {
  kind: 'descendant';
  of: FinderSpec;
  matching: FinderSpec;
}
export type FinderSpec = NativeFinderSpec | DescendantFinderSpec;

export interface DescendantFinderInput {
  kind: 'descendant';
  of: FinderInput;
  matching: FinderInput;
}
export type FinderInput =
  | { kind: 'key'; value: string }
  | {
      kind: 'text';
      value: string;
      matchType?: 'exact' | 'contains' | 'regex' | undefined;
    }
  | { kind: 'type'; value: string }
  | { kind: 'coords'; x: number; y: number }
  | { kind: 'focused' }
  | { kind: 'tooltip'; value: string }
  | {
      kind: 'semantics';
      label: string;
      matchType?: 'exact' | 'contains' | undefined;
    }
  | DescendantFinderInput;

export const FinderSchema: z.ZodType<FinderSpec, z.ZodTypeDef, FinderInput> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    ...baseFinderShapes,
    z.object({
      kind: z.literal('descendant'),
      of: FinderSchema,
      matching: FinderSchema,
    }),
  ]),
);

// Translate a native finder into the matcher JSON the Dart side expects.
// Returns null when the finder needs server-side resolution.
export function toNativeMatcherJson(finder: FinderSpec): Record<string, string> | null {
  switch (finder.kind) {
    case 'key':
      return { key: finder.value };
    case 'text':
      // The Dart TextMatcher only supports exact match today.
      if (finder.matchType !== 'exact') return null;
      return { text: finder.value };
    case 'type':
      return { type: finder.value };
    case 'coords':
      return { x: String(finder.x), y: String(finder.y) };
    case 'focused':
      return { focused: 'true' };
    case 'tooltip':
    case 'semantics':
    case 'descendant':
      return null;
  }
}

// Element shape returned by ext.flutter.ultra.interactiveElements (per
// dart/ultra_flutter/lib/src/services/element_tree_finder.dart).
export interface InteractiveElement {
  type: string;
  key?: string;
  text?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  visible?: boolean;
  // Plus arbitrary DiagnosticPropertiesBuilder properties (string-stringified).
  [extra: string]: unknown;
}

export const InteractiveElementsResponseSchema = z.object({
  elements: z.array(z.record(z.string(), z.unknown())),
});

export function elementMatches(element: InteractiveElement, finder: FinderSpec): boolean {
  switch (finder.kind) {
    case 'key':
      return element.key === finder.value;
    case 'text': {
      const text = element.text ?? '';
      switch (finder.matchType) {
        case 'contains':
          return text.includes(finder.value);
        case 'regex':
          return new RegExp(finder.value).test(text);
        case 'exact':
        default:
          return text === finder.value;
      }
    }
    case 'type':
      return element.type === finder.value;
    case 'coords':
      return (
        !!element.bounds &&
        finder.x >= element.bounds.x &&
        finder.x <= element.bounds.x + element.bounds.width &&
        finder.y >= element.bounds.y &&
        finder.y <= element.bounds.y + element.bounds.height
      );
    case 'focused':
      // We cannot determine focus from interactiveElements output. Caller
      // must use the native-finder fast path.
      return false;
    case 'tooltip': {
      // DiagnosticProperty "tooltip" is auto-extracted into the element map
      // as a stringified value.
      const tooltip = element['tooltip'];
      return typeof tooltip === 'string' && tooltip === finder.value;
    }
    case 'semantics': {
      // Similarly, semantic labels often appear as "label" / "semanticsLabel".
      const candidates = [element['semanticsLabel'], element['label'], element['hint']].filter(
        (v): v is string => typeof v === 'string',
      );
      switch (finder.matchType) {
        case 'contains':
          return candidates.some((v) => v.includes(finder.label));
        case 'exact':
        default:
          return candidates.some((v) => v === finder.label);
      }
    }
    case 'descendant': {
      // Resolved by caller — at this leaf we only know about a single
      // element, not its ancestry. The descendant resolver walks the list and
      // checks bounds containment.
      return elementMatches(element, finder.matching);
    }
  }
}

// Resolve a server-side finder into a {x, y} coords by materialising the
// interactive-elements list. Returns the first matching element's centre, or
// null if no match.
export function resolveFinderToCoords(
  elements: InteractiveElement[],
  finder: FinderSpec,
): { x: number; y: number } | null {
  const filtered = filterElements(elements, finder);
  if (filtered.length === 0) return null;
  const first = filtered[0]!;
  if (!first.bounds) return null;
  return {
    x: first.bounds.x + first.bounds.width / 2,
    y: first.bounds.y + first.bounds.height / 2,
  };
}

export function filterElements(
  elements: InteractiveElement[],
  finder: FinderSpec,
): InteractiveElement[] {
  if (finder.kind === 'descendant') {
    const ancestors = filterElements(elements, finder.of);
    if (ancestors.length === 0) return [];
    const matches = elements.filter((e) => elementMatches(e, finder.matching));
    return matches.filter((m) => ancestors.some((a) => containsBounds(a.bounds, m.bounds)));
  }
  return elements.filter((e) => elementMatches(e, finder));
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
