// FinderSpec — shared discriminated union for widget-lookup tools.
//
// One canonical schema, two consumers:
//   - runtime: widget_exists / find_widget (read-only)
//   - gesture: tap / double_tap / long_press / enter_text / scroll_to / wait_for
//
// Designed pre-emptively for the AC-R5 (rev 23) widget triage workflow so
// runtime's "is the widget in the tree?" answer matches gesture's "I'll tap it"
// target exactly.

import { z } from 'zod';

export const TextMatchTypeSchema = z.enum(['exact', 'contains', 'regex']);
export type TextMatchType = z.infer<typeof TextMatchTypeSchema>;

// Base discriminated union. NOT recursive (ancestor would create a cycle that
// makes z.discriminatedUnion's strictness hard to retain). Ancestor-chain
// search is exposed as a separate `find_widget(filter)` option.
export const FinderSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('key'),
      value: z.string().describe('Stringified widget Key (ValueKey<String> or Key).'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('text'),
      value: z.string(),
      matchType: TextMatchTypeSchema.default('exact'),
      caseInsensitive: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('type'),
      value: z.string().describe('Widget runtimeType name (e.g. "ElevatedButton").'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('coords'),
      x: z.number().describe('Logical pixel X coordinate (viewport-relative).'),
      y: z.number().describe('Logical pixel Y coordinate (viewport-relative).'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('semanticsLabel'),
      value: z.string(),
      matchType: TextMatchTypeSchema.default('exact'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tooltip'),
      value: z.string(),
      matchType: TextMatchTypeSchema.default('exact'),
    })
    .strict(),
]);
export type FinderSpec = z.infer<typeof FinderSchema>;

export const RectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict();
export type Rect = z.infer<typeof RectSchema>;

// String comparison helper used by both widget_exists and tap predicate
// resolution. Same semantics → consistent agent UX.
export function matchesText(
  candidate: string,
  spec: { value: string; matchType?: TextMatchType; caseInsensitive?: boolean },
): boolean {
  const matchType = spec.matchType ?? 'exact';
  const ci = spec.caseInsensitive ?? false;
  const c = ci ? candidate.toLowerCase() : candidate;
  const v = ci ? spec.value.toLowerCase() : spec.value;
  switch (matchType) {
    case 'exact':
      return c === v;
    case 'contains':
      return c.includes(v);
    case 'regex':
      try {
        return new RegExp(spec.value, ci ? 'i' : '').test(candidate);
      } catch {
        return false;
      }
  }
}
