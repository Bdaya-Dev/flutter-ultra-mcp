// Tool registration glue.
//
// Each OS path implements DesktopBackend; this module wires the 9 tools
// onto a FlutterUltraServer instance pointing at a single backend. When
// `backend` is null (sidecar absent or unsupported OS), ZERO tools register
// (AC-ND4) and the server still boots cleanly with a logged warning.

import { z } from 'zod';
import type { FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DesktopBackend } from './types.js';
import { describeMacError } from './backends/macos.js';

export interface RegisterDesktopToolsOptions {
  server: FlutterUltraServer;
  backend: DesktopBackend | null;
  // When set, tool names are prefixed (e.g. "mac_list_windows"). Default ''
  // emits the canonical names from plan §5.6. Worker-I/K share this module
  // post-merge; the unified server omits the prefix because only one OS
  // path can be active per host.
  toolPrefix?: string;
}

export function registerDesktopTools(opts: RegisterDesktopToolsOptions): number {
  if (!opts.backend) {
    opts.server.logger.warn('desktop backend not available — registering zero tools', {
      remediation: 'see startup log for per-OS helper paths / TCC permission state',
    });
    return 0;
  }
  const backend = opts.backend;
  const prefix = opts.toolPrefix ?? '';
  const t = (name: string): string => `${prefix}${name}`;
  let count = 0;

  // list_windows
  opts.server.defineTool(
    {
      name: t('list_windows'),
      description:
        'List top-level windows visible to the OS UI tree. Optional filter by processName or titlePattern (substring match).',
      inputShape: {
        processName: z.string().optional(),
        titlePattern: z.string().optional(),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        const windows = await backend.listWindows(args);
        return { windows, count: windows.length };
      } catch (err) {
        throw new Error(describeMacError(err));
      }
    },
  );
  count++;

  // dump_window_tree
  opts.server.defineTool(
    {
      name: t('dump_window_tree'),
      description:
        'Return the accessibility tree for a specific window. maxDepth bounds traversal (default 12).',
      inputShape: {
        windowId: z.string(),
        maxDepth: z.number().int().positive().max(64).optional(),
      },
      timeoutClass: 'long',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        return backend.dumpWindowTree(args);
      } catch (err) {
        throw new Error(describeMacError(err));
      }
    },
  );
  count++;

  // desktop_query
  opts.server.defineTool(
    {
      name: t('desktop_query'),
      description:
        'XPath-style query over a window\'s a11y tree. Supported subset: //role, //role[@name="X"], //*[@label~="X"]. Returns matched nodes.',
      inputShape: {
        windowId: z.string(),
        query: z.string(),
        maxResults: z.number().int().positive().max(500).optional(),
      },
      timeoutClass: 'long',
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const matches = await backend.desktopQuery(args);
        return { matches, count: matches.length };
      } catch (err) {
        throw new Error(describeMacError(err));
      }
    },
  );
  count++;

  // desktop_click
  opts.server.defineTool(
    {
      name: t('desktop_click'),
      description:
        'Click on a window. Provide either elementId (preferred — backend re-resolves via a11y) or absolute x/y screen coordinates. Default: left button, single click.',
      inputShape: {
        windowId: z.string(),
        elementId: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        button: z.enum(['left', 'right', 'middle']).optional(),
        clickCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      },
      timeoutClass: 'quick',
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        return backend.desktopClick(args);
      } catch (err) {
        throw new Error(describeMacError(err));
      }
    },
  );
  count++;

  // desktop_type
  opts.server.defineTool(
    {
      name: t('desktop_type'),
      description:
        'Type text. If elementId is set, focus that element first; else type into the currently-focused widget. clearFirst sends Cmd+A then Delete (macOS) / Ctrl+A then Delete (Windows/Linux) first.',
      inputShape: {
        windowId: z.string(),
        text: z.string(),
        elementId: z.string().optional(),
        clearFirst: z.boolean().optional(),
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      try {
        return backend.desktopType(args);
      } catch (err) {
        throw new Error(describeMacError(err));
      }
    },
  );
  count++;

  // desktop_screenshot
  opts.server.defineTool(
    {
      name: t('desktop_screenshot'),
      description:
        'Capture a window screenshot. scope="window" (default) snaps the window bounds; scope="screen" snaps the full screen containing the window. Returns base64-encoded PNG.',
      inputShape: {
        windowId: z.string(),
        scope: z.enum(['window', 'screen']).optional(),
      },
      timeoutClass: 'long',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        const { pngBase64 } = await backend.desktopScreenshot(args);
        return {
          content: [{ type: 'image' as const, data: pngBase64, mimeType: 'image/png' }],
        };
      } catch (err) {
        throw new Error(describeMacError(err));
      }
    },
  );
  count++;

  // select_file_in_dialog
  opts.server.defineTool(
    {
      name: t('select_file_in_dialog'),
      description:
        'High-level helper: locate the frontmost file-open/save dialog, type the path, and click the confirm button (Open/Save/Choose; override via confirmButton).',
      inputShape: {
        path: z.string(),
        confirmButton: z.string().optional(),
        windowId: z.string().optional(),
        processName: z.string().optional(),
      },
      timeoutClass: 'long',
    },
    async (args) => {
      try {
        return backend.selectFileInDialog(args);
      } catch (err) {
        throw new Error(describeMacError(err));
      }
    },
  );
  count++;

  // confirm_dialog
  opts.server.defineTool(
    {
      name: t('confirm_dialog'),
      description:
        'Smart dialog confirm by intent (allow/deny/ok/cancel/yes/no/open/save). Backend maps intent to the matching localized button text.',
      inputShape: {
        intent: z.enum(['allow', 'deny', 'ok', 'cancel', 'yes', 'no', 'open', 'save']),
        windowId: z.string().optional(),
        processName: z.string().optional(),
      },
      timeoutClass: 'long',
    },
    async (args) => {
      try {
        return backend.confirmDialog(args);
      } catch (err) {
        throw new Error(describeMacError(err));
      }
    },
  );
  count++;

  // wait_for_window
  opts.server.defineTool(
    {
      name: t('wait_for_window'),
      description:
        'Poll until a window matching titlePattern (regex) or processName appears. timeoutMs default 30_000, pollMs default 250.',
      inputShape: {
        titlePattern: z.string().optional(),
        processName: z.string().optional(),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(10 * 60_000)
          .optional(),
        pollMs: z.number().int().positive().max(5_000).optional(),
      },
      timeoutClass: 'marathon',
      // Bump the watchdog so the per-call timeoutMs can run to completion.
      ceilingMs: 10 * 60_000 + 5_000,
    },
    async (args) => {
      try {
        return backend.waitForWindow(args);
      } catch (err) {
        throw new Error(describeMacError(err));
      }
    },
  );
  count++;

  opts.server.logger.info('desktop tools registered', {
    count,
    platform: backend.capabilities.platform,
    prefix,
  });
  return count;
}
