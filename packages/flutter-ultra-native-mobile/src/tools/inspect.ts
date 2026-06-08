// Inspect / list tools: list_devices, dump_a11y_tree, wait_for_native_element.

import { z } from 'zod';
import type { FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import { InvalidToolInputError } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { listDevicesSchema, dumpA11ySchema, waitForNativeElementSchema } from '../schemas.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { findNode, parseUiautomatorXml, parseWdaSourceXml, type A11yNode } from '../a11y.js';

// ── Compact tree helpers ────────────────────────────────────────────────────

/** Fields kept on each A11yNode when compact mode is active. */
const A11Y_KEEP_FIELDS = new Set([
  'resource-id', 'resourceId', 'text', 'content-desc', 'contentDesc',
  'class', 'className', 'bounds', 'clickable', 'focusable', 'focused',
  'checked', 'selected', 'enabled', 'children', 'path',
]);

/**
 * Recursively compact an A11yNode tree:
 * 1. Keep only fields in `keepFields` plus `children`.
 * 2. Remove null / undefined / empty-string values.
 * 3. Flatten nodes that carry no identifying info (only children + path).
 */
function compactA11yTree(node: A11yNode): A11yNode[] {
  // Compact children first (depth-first).
  const compactedChildren: A11yNode[] = [];
  for (const child of node.children) {
    compactedChildren.push(...compactA11yTree(child));
  }

  // Build a stripped copy keeping only allowed fields.
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'children') continue;
    if (!A11Y_KEEP_FIELDS.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    stripped[key] = value;
  }
  if (compactedChildren.length > 0) {
    stripped.children = compactedChildren;
  }

  const result = stripped as unknown as A11yNode;
  if (compactedChildren.length > 0) {
    result.children = compactedChildren;
  } else {
    result.children = [];
  }

  // If the node has no identifying info beyond path + children, flatten it
  // by hoisting its children to the parent level.
  const identifyingKeys = Object.keys(stripped).filter(
    (k) => k !== 'children' && k !== 'path',
  );
  if (identifyingKeys.length === 0 && compactedChildren.length > 0) {
    return compactedChildren;
  }
  // Drop nodes with zero identifying info AND zero children.
  if (identifyingKeys.length === 0 && compactedChildren.length === 0) {
    return [];
  }

  return [result];
}

function compactA11yRoot(root: A11yNode): A11yNode {
  const results = compactA11yTree(root);
  if (results.length === 1 && results[0]) return results[0];
  // Multiple roots after flattening — wrap in synthetic root.
  return { path: '', children: results };
}

export function registerInspectTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'list_devices',
      description:
        'Enumerate attached Android (adb), iOS Simulator (simctl, macOS only), and iOS physical (go-ios) devices. Returns id + platform + state so subsequent tools can target one.',
      inputShape: listDevicesSchema.shape,
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const devices = await registry.list();
      if (!args.includeOffline) {
        return {
          count: devices.filter((d) => d.state === 'device' || d.state === 'Booted').length,
          devices: devices.filter((d) => d.state === 'device' || d.state === 'Booted'),
        };
      }
      return { count: devices.length, devices };
    },
  );

  server.defineTool(
    {
      name: 'dump_a11y_tree',
      description:
        'Dump the accessibility tree of the currently foregrounded app. Android: uiautomator dump → parsed XML. iOS: planned XCUITest dump (Mac only). Returns a structured tree with bounds, resource-ids, content-desc, text, and click/focus flags.',
      inputShape: dumpA11ySchema.shape,
      timeoutClass: 'long',
      annotations: { readOnlyHint: true },
    },
    async (args, { signal, sendProgress }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      sendProgress({ progress: 0, message: 'requesting device a11y dump' });
      if (device instanceof AndroidDevice) {
        const xml = await device.uiautomatorDumpXml({
          timeoutMs: args.timeoutMs,
          signal,
        });
        sendProgress({ progress: 0.7, message: 'parsing UIAutomator XML' });
        const tree = parseUiautomatorXml(xml);
        return { platform: 'android', deviceId: args.deviceId, tree: args.compact ? compactA11yRoot(tree) : tree };
      }
      if (device instanceof IosSimDevice) {
        sendProgress({ progress: 0.2, message: 'fetching WDA /source from iOS Simulator' });
        const xml = await device.wdaFetchSource(args.wdaPort, {
          timeoutMs: args.timeoutMs,
          signal,
        });
        sendProgress({ progress: 0.7, message: 'parsing WDA accessibility XML' });
        const tree = parseWdaSourceXml(xml);
        return { platform: 'ios-sim', deviceId: args.deviceId, tree: args.compact ? compactA11yRoot(tree) : tree };
      }
      throw new InvalidToolInputError(
        `dump_a11y_tree: device kind '${device.kind}' not supported.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'wait_for_native_element',
      description:
        'Poll dump_a11y_tree until an element matching the finder appears, or until the timeout fires.',
      inputShape: waitForNativeElementSchema.shape,
      timeoutClass: 'long',
      annotations: { readOnlyHint: true },
    },
    async (args, { signal, sendProgress }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      const deadline = Date.now() + args.timeoutMs;
      let polls = 0;
      const finder = {
        ...(args.finder.text !== undefined ? { text: args.finder.text } : {}),
        ...(args.finder.textContains !== undefined
          ? { textContains: args.finder.textContains }
          : {}),
        ...(args.finder.resourceId !== undefined ? { resourceId: args.finder.resourceId } : {}),
        ...(args.finder.contentDesc !== undefined ? { contentDesc: args.finder.contentDesc } : {}),
        ...(args.finder.className !== undefined ? { className: args.finder.className } : {}),
        index: args.finder.index,
      };
      while (Date.now() < deadline) {
        if (signal.aborted) throw signal.reason as Error;
        polls += 1;
        sendProgress({ progress: polls, message: `polling a11y tree (${polls})` });
        try {
          let tree;
          if (device instanceof AndroidDevice) {
            const xml = await device.uiautomatorDumpXml({
              timeoutMs: Math.min(15_000, deadline - Date.now()),
              signal,
            });
            tree = parseUiautomatorXml(xml);
          } else if (device instanceof IosSimDevice) {
            const xml = await device.wdaFetchSource(args.wdaPort, {
              timeoutMs: Math.min(25_000, deadline - Date.now()),
              signal,
            });
            tree = parseWdaSourceXml(xml);
          } else {
            throw new InvalidToolInputError(
              `wait_for_native_element: device kind '${device.kind}' not supported.`,
            );
          }
          const node = findNode(tree, finder);
          if (node) {
            return { matched: true, polls, node };
          }
        } catch (err) {
          if (signal.aborted) throw err;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, args.pollIntervalMs).unref?.());
      }
      return { matched: false, polls, timeoutMs: args.timeoutMs };
    },
  );
}

export const _internal = { z };
