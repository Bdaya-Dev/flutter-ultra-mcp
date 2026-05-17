// Screenshot + screencast tools.
//
// `take_screenshots` delegates to `ext.flutter.ultra.takeScreenshots`.
// `take_responsive_screenshots` (plan §5.3 line 577) delegates per-target:
//   - web: requires `flutter-ultra-browser` to set viewport via CDP. We can't
//     drive Playwright from this server (separate process), so we return a
//     manifest the agent passes to flutter-ultra-browser/take_responsive_screenshots.
//   - native: viewport is OS-window-controlled. We capture once and warn.
// `start_screencast` / `stop_screencast` delegate to the Dart screencast server.

import { z } from 'zod';
import { callUltraExtension, stringifyArgs } from '../extension.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const TakeScreenshotsInput = SessionIdInput;

const ViewportNameSchema = z.enum(['compact', 'medium', 'expanded', 'large']);

const NamedViewportSchema = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const TakeResponsiveScreenshotsInput = SessionIdInput.extend({
  viewports: z
    .union([z.array(ViewportNameSchema), z.array(NamedViewportSchema)])
    .default(['compact', 'medium', 'expanded', 'large']),
  target: z.enum(['web', 'native']).default('web'),
  // Required for web target — agent must already have linked a browser context.
  browserContextId: z.string().optional(),
});

const StartScreencastInput = SessionIdInput.extend({
  maxWidth: z.number().int().positive().optional(),
  maxHeight: z.number().int().positive().optional(),
  wsPort: z.number().int().min(1).max(65535).optional(),
});

const StopScreencastInput = SessionIdInput;

// Invora's TestScreenSize defaults — keep in sync with plan §5.3 line 577.
const DEFAULT_VIEWPORTS: Record<
  z.infer<typeof ViewportNameSchema>,
  { width: number; height: number }
> = {
  compact: { width: 400, height: 800 },
  medium: { width: 700, height: 900 },
  expanded: { width: 1000, height: 900 },
  large: { width: 1400, height: 900 },
};

export function takeScreenshotsTool(
  registry: SessionRegistry,
): GestureTool<typeof TakeScreenshotsInput, z.ZodTypeAny> {
  return defineTool({
    name: 'take_screenshots',
    description:
      'Capture one PNG per RenderView via ext.flutter.ultra.takeScreenshots. Faster than the inspector screenshot.',
    inputSchema: TakeScreenshotsInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.takeScreenshots',
      );
    },
  });
}

export function takeResponsiveScreenshotsTool(
  registry: SessionRegistry,
): GestureTool<typeof TakeResponsiveScreenshotsInput, z.ZodTypeAny> {
  return defineTool({
    name: 'take_responsive_screenshots',
    description:
      'Capture screenshots at multiple viewport sizes. Web: returns a manifest the agent passes to flutter-ultra-browser/take_responsive_screenshots (which calls CDP setDeviceMetricsOverride per viewport). Native: captures once and warns via nativeMultiViewportUnavailable.',
    inputSchema: TakeResponsiveScreenshotsInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const viewports = normaliseViewports(input.viewports);

      if (input.target === 'native') {
        const single = await callUltraExtension<unknown>(
          handle.client,
          handle.isolateId,
          'ext.flutter.ultra.takeScreenshots',
        );
        return {
          target: 'native',
          nativeMultiViewportUnavailable: true,
          fallbackScreenshot: single,
          requestedViewports: viewports,
        };
      }

      // Web target — return delegation manifest. The agent (or skill) will
      // pass this to flutter-ultra-browser/take_responsive_screenshots, which
      // owns the Playwright context.
      return {
        target: 'web',
        delegateTo: 'flutter-ultra-browser/take_responsive_screenshots',
        sessionId: input.sessionId,
        browserContextId: input.browserContextId ?? null,
        viewports,
      };
    },
  });
}

function normaliseViewports(
  raw: z.infer<typeof TakeResponsiveScreenshotsInput>['viewports'],
): { name: string; width: number; height: number }[] {
  return raw.map((v) => {
    if (typeof v === 'string') {
      const dims = DEFAULT_VIEWPORTS[v];
      return { name: v, ...dims };
    }
    return v;
  });
}

export function startScreencastTool(
  registry: SessionRegistry,
): GestureTool<typeof StartScreencastInput, z.ZodTypeAny> {
  return defineTool({
    name: 'start_screencast',
    description:
      'Start an MJPEG screencast server in the target app. Returns the wsURL where frames stream. AC-G3: ≥ 10 fps sustained over 30s.',
    inputSchema: StartScreencastInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const args: Record<string, unknown> = {};
      if (input.maxWidth !== undefined) args.maxWidth = input.maxWidth;
      if (input.maxHeight !== undefined) args.maxHeight = input.maxHeight;
      if (input.wsPort !== undefined) args.wsPort = input.wsPort;
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.startScreencast',
        stringifyArgs(args),
      );
    },
  });
}

export function stopScreencastTool(
  registry: SessionRegistry,
): GestureTool<typeof StopScreencastInput, z.ZodTypeAny> {
  return defineTool({
    name: 'stop_screencast',
    description: 'Stop an active screencast. Idempotent — safe to call when no cast is running.',
    inputSchema: StopScreencastInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.stopScreencast',
      );
    },
  });
}
