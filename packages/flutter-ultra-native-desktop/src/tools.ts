// MCP tool registry for flutter-ultra-native-desktop.
//
// Tools dispatch through the platform-agnostic `DesktopBackend` interface
// (worker I provides WindowsDesktopBackend, worker J the macOS variant,
// this package the Linux AT-SPI variant). Tool names stay snake_case for
// MCP/LLM ergonomics; backend method names are camelCase for TS parity.
//
// `get_install_hint` is the one exception — it talks directly to the
// device for distro detection because it must work even when the backend
// failed to boot.

import { z } from 'zod';
import { zodToJsonSchema, type JsonSchema } from './json-schema.js';
import type { DesktopBackend, FindCriteria } from './backend.js';
import type { Device } from './device.js';
import { detectDeviceDistro, detectLocalDistro } from './platform.js';

export interface ToolContext {
  device: Device;
  backend: DesktopBackend;
}

export interface Tool<I extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: I;
  inputJsonSchema: JsonSchema;
  handler: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>;
}

function defineTool<I extends z.ZodTypeAny>(spec: {
  name: string;
  description: string;
  inputSchema: I;
  handler: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>;
}): Tool<I> {
  return {
    ...spec,
    inputJsonSchema: zodToJsonSchema(spec.inputSchema),
  };
}

const Empty = z.object({});
const NodeIdInput = z.object({ nodeId: z.string().min(1) });
const FindByNameInput = z.object({
  name: z.string().min(1),
  exact: z.boolean().optional(),
  rootNodeId: z.string().optional(),
});
const FindByRoleInput = z.object({
  role: z.string().min(1),
  rootNodeId: z.string().optional(),
});
const FindByIdInput = z.object({
  id: z.string().min(1),
  rootNodeId: z.string().optional(),
});
const TypeTextInput = z.object({
  nodeId: z.string().min(1),
  text: z.string(),
  clear: z.boolean().optional(),
});
const WaitForInput = z.object({
  criteria: z.object({
    type: z.enum(['name', 'role', 'id']),
    name: z.string().optional(),
    role: z.string().optional(),
    id: z.string().optional(),
    rootNodeId: z.string().optional(),
    exact: z.boolean().optional(),
  }),
  timeoutMs: z.number().int().positive().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
});

export function allTools(): Tool[] {
  // Each entry comes in with a narrower generic; cast through the bivariant
  // erased view used by the Server dispatch loop (same pattern as the
  // gesture server).
  const tools = [
    defineTool({
      name: 'get_status',
      description:
        'Probe backend availability without holding a connection. Returns the a11y binding init state, the display server (x11/wayland on Linux), and a structured warning if coverage is limited.',
      inputSchema: Empty,
      handler: async (_input, ctx) => ctx.backend.status(),
    }),
    defineTool({
      name: 'get_install_hint',
      description:
        'Detect the operating system on the active device and return the exact package-install command needed for the native-desktop binding. On Linux: distro-specific (apt/dnf/pacman/zypper/apk). On other platforms: dispatched to the per-platform backend.',
      inputSchema: Empty,
      handler: async (_input, ctx) => {
        if (ctx.device.platform === 'linux') {
          return ctx.device.kind === 'local' ? detectLocalDistro() : detectDeviceDistro(ctx.device);
        }
        // Non-Linux: defer to the backend's status which carries platform notes.
        return ctx.backend.status();
      },
    }),
    defineTool({
      name: 'list_windows',
      description:
        'List every visible window grouped by application. Returns nodeId, role, name, attributes, states, and on-screen extents. NodeIds are stable across requests within a desktop snapshot.',
      inputSchema: Empty,
      handler: async (_input, ctx) => ctx.backend.listWindows(),
    }),
    defineTool({
      name: 'get_active_window',
      description:
        'Return the window currently in the OS-reported ACTIVE state (the focused top-level), or null if none reports active.',
      inputSchema: Empty,
      handler: async (_input, ctx) => ctx.backend.getActiveWindow(),
    }),
    defineTool({
      name: 'get_node',
      description:
        'Re-fetch a single accessible by nodeId. Includes name, role, description, attributes, states, child count, and on-screen extents.',
      inputSchema: NodeIdInput,
      handler: async (input, ctx) => ctx.backend.getNode(input.nodeId),
    }),
    defineTool({
      name: 'get_children',
      description:
        'List direct children of a node. Each child carries its derived nodeId so it can be referenced in subsequent calls.',
      inputSchema: NodeIdInput,
      handler: async (input, ctx) => ctx.backend.getChildren(input.nodeId),
    }),
    defineTool({
      name: 'get_text',
      description:
        'Read text content from a node via the platform-specific Text interface (AT-SPI Text on Linux, UIA TextPattern on Windows, AX kAXValueAttribute on macOS).',
      inputSchema: NodeIdInput,
      handler: async (input, ctx) => ctx.backend.getText(input.nodeId),
    }),
    defineTool({
      name: 'find_by_name',
      description:
        'Walk the accessible tree and return every node whose accessible-name matches. `exact` defaults to true; set false for case-insensitive substring match. `rootNodeId` scopes the walk.',
      inputSchema: FindByNameInput,
      handler: async (input, ctx) => {
        const options: { exact?: boolean; rootNodeId?: string } = {};
        if (input.exact !== undefined) options.exact = input.exact;
        if (input.rootNodeId !== undefined) options.rootNodeId = input.rootNodeId;
        return ctx.backend.findByName(input.name, options);
      },
    }),
    defineTool({
      name: 'find_by_role',
      description:
        'Walk the accessible tree and return every node whose role matches (machine form: push_button, text, dialog, ...). `rootNodeId` scopes the walk.',
      inputSchema: FindByRoleInput,
      handler: async (input, ctx) => {
        const options: { rootNodeId?: string } = {};
        if (input.rootNodeId !== undefined) options.rootNodeId = input.rootNodeId;
        return ctx.backend.findByRole(input.role, options);
      },
    }),
    defineTool({
      name: 'find_by_id',
      description:
        'Walk the accessible tree and return every node whose developer-set id matches (AT-SPI Accessible.get_id, UIA AutomationId, AX kAXIdentifierAttribute). Flutter desktop apps rarely set this; prefer find_by_name + role.',
      inputSchema: FindByIdInput,
      handler: async (input, ctx) => {
        const options: { rootNodeId?: string } = {};
        if (input.rootNodeId !== undefined) options.rootNodeId = input.rootNodeId;
        return ctx.backend.findById(input.id, options);
      },
    }),
    defineTool({
      name: 'click',
      description:
        'Invoke the default activation action on a node (AT-SPI Action interface "click"/"press"/"activate"; UIA Invoke pattern; AX kAXPressAction). Throws if the node is not actionable.',
      inputSchema: NodeIdInput,
      handler: async (input, ctx) => ctx.backend.click(input.nodeId),
    }),
    defineTool({
      name: 'double_click',
      description:
        'Invoke the click action twice with a short gap. AT-SPI has no native double-click semantics; for real WM-level double-click use a future X11/Wayland synthesised-input path.',
      inputSchema: NodeIdInput,
      handler: async (input, ctx) => ctx.backend.doubleClick(input.nodeId),
    }),
    defineTool({
      name: 'type_text',
      description:
        'Insert text via the platform-specific editable-text interface (AT-SPI EditableText, UIA ValuePattern.SetValue, AX kAXValueAttribute). `clear: true` first deletes existing content.',
      inputSchema: TypeTextInput,
      handler: async (input, ctx) => {
        const options: { clear?: boolean } = {};
        if (input.clear !== undefined) options.clear = input.clear;
        return ctx.backend.typeText(input.nodeId, input.text, options);
      },
    }),
    defineTool({
      name: 'grab_focus',
      description:
        'Request focus on a node (AT-SPI Component.grabFocus, UIA SetFocus, AX kAXFocusedAttribute). Honoured by most native widgets; Flutter desktop sometimes ignores it because Flutter manages its own focus tree.',
      inputSchema: NodeIdInput,
      handler: async (input, ctx) => ctx.backend.grabFocus(input.nodeId),
    }),
    defineTool({
      name: 'wait_for',
      description:
        'Poll find_by_name/role/id until at least one match appears or timeoutMs elapses. Default timeout 5s, poll 250ms. Throws on timeout with the last poll count.',
      inputSchema: WaitForInput,
      handler: async (input, ctx) => {
        const options: { timeoutMs?: number; pollIntervalMs?: number } = {};
        if (input.timeoutMs !== undefined) options.timeoutMs = input.timeoutMs;
        if (input.pollIntervalMs !== undefined) options.pollIntervalMs = input.pollIntervalMs;
        return ctx.backend.waitFor(input.criteria as FindCriteria, options);
      },
    }),
  ] as unknown as Tool[];
  return tools;
}
