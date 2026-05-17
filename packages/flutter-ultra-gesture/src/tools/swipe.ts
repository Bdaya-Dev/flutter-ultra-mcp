// `swipe` and `pinch_zoom`.
//
// Swipe supports two modes:
//   - coordinate-based: `{ startX, startY, endX, endY }`
//   - element-based: `{ finder, direction, distance? }`

import { z } from 'zod';
import { callUltraExtension, stringifyArgs } from '../extension.js';
import { FinderSchema, toNativeMatcherJson } from '../finder.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const DirectionSchema = z.enum(['left', 'right', 'up', 'down']);

const CoordSwipeInput = SessionIdInput.extend({
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
});

const ElementSwipeInput = SessionIdInput.extend({
  finder: FinderSchema,
  direction: DirectionSchema,
  distance: z.number().positive().optional(),
});

const SwipeInput = z.union([CoordSwipeInput, ElementSwipeInput]);

const PinchZoomInput = SessionIdInput.extend({
  finder: FinderSchema,
  scale: z.number().positive(),
  startDistance: z.number().positive().optional(),
});

export function swipeTool(registry: SessionRegistry): GestureTool<typeof SwipeInput, z.ZodTypeAny> {
  return defineTool({
    name: 'swipe',
    description:
      'Dispatch a swipe gesture. Coordinate form: { startX, startY, endX, endY }. Element form: { finder, direction, distance? } where direction is left|right|up|down and distance defaults to 200px.',
    inputSchema: SwipeInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      if ('startX' in input) {
        return callUltraExtension(
          handle.client,
          handle.isolateId,
          'ext.flutter.ultra.swipe',
          stringifyArgs({
            startX: input.startX,
            startY: input.startY,
            endX: input.endX,
            endY: input.endY,
          }),
        );
      }
      const native = toNativeMatcherJson(input.finder);
      if (native === null) {
        throw new Error(
          'Element-form swipe only supports native finders. ' +
            `Got finder kind '${input.finder.kind}'. ` +
            'Resolve to coords via interactive_elements + use coordinate-form swipe instead.',
        );
      }
      const args: Record<string, unknown> = {
        ...native,
        direction: input.direction,
      };
      if (input.distance !== undefined) args.distance = input.distance;
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.swipe',
        stringifyArgs(args),
      );
    },
  });
}

export function pinchZoomTool(
  registry: SessionRegistry,
): GestureTool<typeof PinchZoomInput, z.ZodTypeAny> {
  return defineTool({
    name: 'pinch_zoom',
    description:
      'Dispatch a two-finger pinch-zoom gesture. `scale > 1` zooms in, `scale < 1` zooms out. `startDistance` (default 200) controls finger separation.',
    inputSchema: PinchZoomInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const native = toNativeMatcherJson(input.finder);
      if (native === null) {
        throw new Error(
          'pinch_zoom only supports native finders. ' + `Got finder kind '${input.finder.kind}'.`,
        );
      }
      const args: Record<string, unknown> = { ...native, scale: input.scale };
      if (input.startDistance !== undefined) {
        args.startDistance = input.startDistance;
      }
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.pinchZoom',
        stringifyArgs(args),
      );
    },
  });
}
