// Registers all 17 gesture tools per plan §5.3.

import { zodToJsonSchema } from '../json-schema.js';
import type { z } from 'zod';

import type { SessionRegistry } from '../session.js';

import { interactiveElementsTool } from './interactive-elements.js';
import { tapTool, doubleTapTool, longPressTool } from './tap.js';
import { enterTextTool, clearTextTool } from './text.js';
import { swipeTool, pinchZoomTool } from './swipe.js';
import { scrollToTool, scrollUntilVisibleTool } from './scroll.js';
import {
  takeScreenshotsTool,
  takeResponsiveScreenshotsTool,
  startScreencastTool,
  stopScreencastTool,
} from './screenshots.js';
import { callCustomExtensionTool, listCustomExtensionsTool } from './custom-extensions.js';
import { waitForTool } from './wait-for.js';

// Erased view used by the request-handler dispatch table — each tool can
// pin its own Zod input/output types internally, but the Server needs a
// homogeneous list to iterate over. We carry the raw Zod schema so the
// handler can re-validate, and a JSON-Schema view for tools/list.
export interface GestureTool<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  inputJsonSchema: ReturnType<typeof zodToJsonSchema>;
  handler: (input: z.infer<TInput>) => Promise<unknown>;
}

export function defineTool<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(spec: {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  handler: (input: z.infer<TInput>) => Promise<unknown>;
}): GestureTool<TInput, TOutput> {
  const base: GestureTool<TInput, TOutput> = {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    inputJsonSchema: zodToJsonSchema(spec.inputSchema),
    handler: spec.handler,
  };
  if (spec.outputSchema !== undefined) {
    base.outputSchema = spec.outputSchema;
  }
  return base;
}

export function allTools(registry: SessionRegistry): GestureTool[] {
  // Each entry comes in with a narrower generic; cast through the bivariant
  // erased view used by the Server dispatch loop.
  return [
    interactiveElementsTool(registry),
    tapTool(registry),
    doubleTapTool(registry),
    longPressTool(registry),
    enterTextTool(registry),
    clearTextTool(registry),
    swipeTool(registry),
    pinchZoomTool(registry),
    scrollToTool(registry),
    scrollUntilVisibleTool(registry),
    takeScreenshotsTool(registry),
    takeResponsiveScreenshotsTool(registry),
    startScreencastTool(registry),
    stopScreencastTool(registry),
    callCustomExtensionTool(registry),
    listCustomExtensionsTool(registry),
    waitForTool(registry),
  ] as unknown as GestureTool[];
}
