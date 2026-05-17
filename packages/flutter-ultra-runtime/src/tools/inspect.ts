// Inspection tools: widget tree, find_widget, widget_exists, screenshot, dumps,
// evaluate, toggle_debug_paint, toggle_perf_overlay, set_time_dilation,
// set_platform_override, get_selected_widget, set_selected_widget.

import { z } from 'zod';
import {
  FinderSchema,
  InvalidToolInputError,
  SessionIdSchema,
  type FlutterUltraServer,
} from '@flutter-ultra/mcp-runtime';
import type { VmServiceClient } from '@flutter-ultra/vm-service-client';
import type { SessionRegistry } from '../sessions.js';
import { fetchSummaryTree, findInTree, summarizeNode, walkTree } from '../widgetTree.js';

const GROUP_NAME = 'flutter-ultra-runtime';

export function registerInspectTools(opts: {
  server: FlutterUltraServer;
  sessions: SessionRegistry;
}): void {
  const { server, sessions } = opts;

  async function resolveIsolate(sessionId: string): Promise<{
    isolateId: string;
    release: () => Promise<void>;
    client: VmServiceClient;
  }> {
    const { client, release } = await sessions.acquireClient(sessionId);
    try {
      const vm = await client.getVM();
      const isolateId = vm.isolates[0]?.id;
      if (!isolateId) {
        await release();
        throw new InvalidToolInputError('Session has no isolates.');
      }
      return { isolateId, client, release };
    } catch (err) {
      await release();
      throw err;
    }
  }

  server.defineTool(
    {
      name: 'get_widget_tree',
      description:
        'Fetch the current root widget tree via ext.flutter.inspector.getRootWidgetTree.',
      inputShape: {
        sessionId: SessionIdSchema,
        groupName: z.string().default(GROUP_NAME),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const tree = await client.callServiceExtension('ext.flutter.inspector.getRootWidgetTree', {
          isolateId,
          args: { groupName: args.groupName },
        });
        return { tree };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'get_widget_details',
      description: 'Detail subtree for a single widget node by its inspector objectId.',
      inputShape: {
        sessionId: SessionIdSchema,
        objectId: z.string().min(1),
        subtreeDepth: z.number().int().positive().default(2),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const details = await client.callServiceExtension(
          'ext.flutter.inspector.getDetailsSubtree',
          {
            isolateId,
            args: {
              objectGroup: GROUP_NAME,
              arg: args.objectId,
              subtreeDepth: String(args.subtreeDepth),
            },
          },
        );
        return { details };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'get_selected_widget',
      description:
        "Inspector's currently selected widget (set by the user via DevTools or by `set_selected_widget`).",
      inputShape: { sessionId: SessionIdSchema },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const result = await client.callServiceExtension(
          'ext.flutter.inspector.getSelectedWidget',
          {
            isolateId,
            args: { objectGroup: GROUP_NAME },
          },
        );
        return { selected: result };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'set_selected_widget',
      description: 'Set the inspector selection to a widget by its inspector valueId.',
      inputShape: {
        sessionId: SessionIdSchema,
        objectId: z.string().min(1),
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const result = await client.callServiceExtension('ext.flutter.inspector.setSelectionById', {
          isolateId,
          args: { objectGroup: GROUP_NAME, arg: args.objectId },
        });
        return { ok: true, result };
      } finally {
        await release();
      }
    },
  );

  // ── AC-R5 (rev 23): widget_exists ─────────────────────────────────────────
  server.defineTool(
    {
      name: 'widget_exists',
      description:
        'AC-R5 (rev 23): Read-only check that a widget matching the FinderSpec is in the live tree. Walks `getRootWidgetSummaryTree` and tests each node. Returns {exists, count, bounds?} in <300ms on a 500-node tree without any side effects (no setState, no hot-reload, no route nav).',
      inputShape: {
        sessionId: SessionIdSchema,
        finder: FinderSchema,
        // When true, also returns the bounds rect for each match if we can
        // derive them. Default off so we stay fast.
        includeBounds: z.boolean().default(false),
      },
      timeoutClass: 'quick',
      ceilingMs: 5_000,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const root = await fetchSummaryTree(client, isolateId);
        if (!root) {
          return { exists: false, count: 0, matched: [] };
        }
        const found = findInTree(root, args.finder, { limit: 1000 });
        const result: { exists: boolean; count: number; bounds?: unknown[]; matched: unknown[] } = {
          exists: found.length > 0,
          count: found.length,
          matched: found.slice(0, 10),
        };
        if (args.includeBounds) {
          result.bounds = found.map((f) => f.bounds).filter((b) => b !== undefined);
        }
        return result;
      } finally {
        await release();
      }
    },
  );

  // ── AC-R5 (rev 23): find_widget ───────────────────────────────────────────
  server.defineTool(
    {
      name: 'find_widget',
      description:
        'AC-R5 (rev 23): Read-only: like widget_exists but returns full node data — type, runtimeType, description, key, bounds, ancestor chain, child count. Useful for "the widget is in the tree but not where I expect — what\'s its actual parent?" triage.',
      inputShape: {
        sessionId: SessionIdSchema,
        finder: FinderSchema,
        limit: z.number().int().positive().default(50),
      },
      timeoutClass: 'quick',
      ceilingMs: 5_000,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const root = await fetchSummaryTree(client, isolateId);
        if (!root) return { matches: [], count: 0 };
        const found = findInTree(root, args.finder, { limit: args.limit });
        return { matches: found, count: found.length };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'screenshot',
      description:
        'Capture a PNG of the current frame via ext.flutter.inspector.screenshot. Returns the image as base64 + an MCP image content block.',
      inputShape: {
        sessionId: SessionIdSchema,
        width: z.number().int().positive().default(800),
        height: z.number().int().positive().default(600),
        margin: z.number().nonnegative().default(0),
        maxPixelRatio: z.number().positive().default(2),
      },
      timeoutClass: 'instant',
      ceilingMs: 10_000,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        // The inspector's screenshot extension targets the inspector's
        // currently selected widget; pass `id: null` (the empty string) to
        // capture the root.
        const root = await fetchSummaryTree(client, isolateId);
        const rootId = root?.valueId ?? '';
        const result = await client.callServiceExtension('ext.flutter.inspector.screenshot', {
          isolateId,
          args: {
            id: rootId,
            width: String(args.width),
            height: String(args.height),
            margin: String(args.margin),
            maxPixelRatio: String(args.maxPixelRatio),
            debugPaint: 'false',
          },
        });
        const b64 = extractScreenshotB64(result);
        if (!b64 || b64.length < 200) {
          throw new InvalidToolInputError(
            `Inspector returned an empty / too-small screenshot (got ${b64?.length ?? 0} bytes). Is the app on a visible frame?`,
          );
        }
        return {
          content: [{ type: 'image', data: b64, mimeType: 'image/png' }],
          structuredContent: { sizeBytes: Buffer.from(b64, 'base64').length },
        };
      } finally {
        await release();
      }
    },
  );

  for (const tool of ['dump_render_tree', 'dump_layer_tree', 'dump_semantics_tree'] as const) {
    const ext = {
      dump_render_tree: 'ext.flutter.debugDumpRenderTree',
      dump_layer_tree: 'ext.flutter.debugDumpLayerTree',
      dump_semantics_tree: 'ext.flutter.debugDumpSemanticsTreeInTraversalOrder',
    }[tool];
    server.defineTool(
      {
        name: tool,
        description: `${ext} → plain-text tree dump.`,
        inputShape: { sessionId: SessionIdSchema },
        timeoutClass: 'long',
        ceilingMs: 60_000,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => {
        const { isolateId, client, release } = await resolveIsolate(args.sessionId);
        try {
          const result = (await client.callServiceExtension(ext, { isolateId })) as
            | Record<string, unknown>
            | string
            | null;
          const dump =
            typeof result === 'string'
              ? result
              : ((result as { result?: string } | null)?.result ?? JSON.stringify(result));
          return { dump };
        } finally {
          await release();
        }
      },
    );
  }

  server.defineTool(
    {
      name: 'evaluate',
      description:
        'Evaluate a Dart expression in the main isolate scope. Returns @Instance / @Error / Sentinel.',
      inputShape: {
        sessionId: SessionIdSchema,
        expression: z.string().min(1),
        targetId: z
          .string()
          .optional()
          .describe(
            'Object to evaluate against. If omitted, evaluates against the root library of the main isolate.',
          ),
        scope: z.record(z.string()).optional(),
        disableBreakpoints: z.boolean().default(true),
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        let targetId = args.targetId;
        if (!targetId) {
          const iso = await client.getIsolate(isolateId);
          targetId = iso.rootLib?.id ?? isolateId;
        }
        const result = await client.evaluate(isolateId, targetId, args.expression, {
          disableBreakpoints: args.disableBreakpoints,
          ...(args.scope !== undefined ? { scope: args.scope } : {}),
        });
        return { result };
      } finally {
        await release();
      }
    },
  );

  for (const tool of [
    { name: 'toggle_debug_paint', ext: 'ext.flutter.debugPaint' },
    { name: 'toggle_perf_overlay', ext: 'ext.flutter.showPerformanceOverlay' },
  ] as const) {
    server.defineTool(
      {
        name: tool.name,
        description: `Toggle ${tool.ext}. Pass {enabled} to set explicitly; omit to query.`,
        inputShape: {
          sessionId: SessionIdSchema,
          enabled: z.boolean().optional(),
        },
        timeoutClass: 'quick',
        ceilingMs: 15_000,
      },
      async (args) => {
        const { isolateId, client, release } = await resolveIsolate(args.sessionId);
        try {
          const result = await client.callServiceExtension(tool.ext, {
            isolateId,
            args: args.enabled !== undefined ? { enabled: String(args.enabled) } : {},
          });
          return { result };
        } finally {
          await release();
        }
      },
    );
  }

  server.defineTool(
    {
      name: 'set_time_dilation',
      description: 'ext.flutter.timeDilation — slow / speed up animations. value=1.0 is default.',
      inputShape: {
        sessionId: SessionIdSchema,
        value: z.number().positive(),
      },
      timeoutClass: 'quick',
      ceilingMs: 15_000,
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const result = await client.callServiceExtension('ext.flutter.timeDilation', {
          isolateId,
          args: { timeDilation: String(args.value) },
        });
        return { result };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'set_platform_override',
      description: 'ext.flutter.platformOverride — render iOS UI on Android target etc.',
      inputShape: {
        sessionId: SessionIdSchema,
        platform: z.enum(['android', 'iOS', 'fuchsia', 'linux', 'macOS', 'windows']).optional(),
      },
      timeoutClass: 'quick',
      ceilingMs: 15_000,
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const result = await client.callServiceExtension('ext.flutter.platformOverride', {
          isolateId,
          args: args.platform !== undefined ? { value: args.platform } : {},
        });
        return { result };
      } finally {
        await release();
      }
    },
  );

  // Useful exposure for the bisect skill: count nodes in the current tree.
  server.defineTool(
    {
      name: 'count_widget_tree_nodes',
      description:
        'Walk the current root widget summary tree and return total node count, max depth, and a list of top-level child types.',
      inputShape: { sessionId: SessionIdSchema },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const root = await fetchSummaryTree(client, isolateId);
        if (!root) return { totalNodes: 0, maxDepth: 0, topLevel: [] };
        let totalNodes = 0;
        let maxDepth = 0;
        const topLevel: string[] = [];
        walkTree(root, (node, depth) => {
          totalNodes += 1;
          if (depth > maxDepth) maxDepth = depth;
          if (depth === 1) topLevel.push(summarizeNode(node, depth, []).type ?? '<unknown>');
          return true;
        });
        return { totalNodes, maxDepth, topLevel };
      } finally {
        await release();
      }
    },
  );
}

function extractScreenshotB64(result: unknown): string | undefined {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj['screenshot'] === 'string') return obj['screenshot'] as string;
    if (typeof obj['result'] === 'string') return obj['result'] as string;
    if (typeof obj['data'] === 'string') return obj['data'] as string;
  }
  return undefined;
}
