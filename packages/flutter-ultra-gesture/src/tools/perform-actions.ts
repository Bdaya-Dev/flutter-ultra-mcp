// `perform_actions` — W3C-style multi-touch action sequences.
//
// Accepts an `actions` array of pointer chains. Each chain has a `pointerId`
// string and a `steps` array. Steps are dispatched in lock-step across all
// chains via `ext.flutter.ultra.performActions`, which interleaves them at the
// Dart level following the W3C Actions interleaving model.

import { z } from 'zod';
import { callUltraExtension } from '../extension.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const PointerDownStep = z.object({
  type: z.literal('pointerDown'),
  x: z.number(),
  y: z.number(),
});

const PointerMoveStep = z.object({
  type: z.literal('pointerMove'),
  x: z.number(),
  y: z.number(),
  duration: z.number().int().nonnegative().default(0),
});

const PointerUpStep = z.object({
  type: z.literal('pointerUp'),
});

const PauseStep = z.object({
  type: z.literal('pause'),
  duration: z.number().int().nonnegative(),
});

const ActionStep = z.discriminatedUnion('type', [
  PointerDownStep,
  PointerMoveStep,
  PointerUpStep,
  PauseStep,
]);

const PointerChain = z.object({
  pointerId: z.string().min(1),
  steps: z.array(ActionStep).min(1),
});

const PerformActionsInput = SessionIdInput.extend({
  actions: z.array(PointerChain).min(1),
});

export function performActionsTool(
  registry: SessionRegistry,
): GestureTool<typeof PerformActionsInput, z.ZodTypeAny> {
  return defineTool({
    name: 'perform_actions',
    description:
      'Execute a W3C-style multi-touch action sequence. ' +
      'Provide one or more pointer chains, each with a unique `pointerId` and a list of steps. ' +
      'Steps: pointerDown({x,y}), pointerMove({x,y,duration?}), pointerUp, pause({duration}). ' +
      'All chains advance in lock-step (W3C interleaving). ' +
      'Use this for pinch, rotate, two-finger swipe, or any custom multi-touch gesture not covered by swipe/pinch_zoom.',
    inputSchema: PerformActionsInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      // The Dart extension expects `actions` as a JSON string because VM service
      // extension params are Map<String, String>.
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.performActions',
        { actions: JSON.stringify(input.actions) },
      );
    },
  });
}
