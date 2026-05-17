// Inspect / list tools: list_devices, dump_a11y_tree, wait_for_native_element.

import { z } from 'zod';
import type { FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import { InvalidToolInputError } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { listDevicesSchema, dumpA11ySchema, waitForNativeElementSchema } from '../schemas.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { findNode, parseUiautomatorXml, type A11yNode } from '../a11y.js';

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
        return { platform: 'android', deviceId: args.deviceId, tree };
      }
      if (device instanceof IosSimDevice) {
        // iOS XCUITest dump requires WebDriverAgent or Apple's privateframework.
        // Surface a structured "unimplemented" so the agent doesn't retry.
        return {
          platform: 'ios-sim',
          deviceId: args.deviceId,
          tree: { path: '', children: [] } as A11yNode,
          unimplemented: true,
          message:
            'dump_a11y_tree on iOS Simulator requires WebDriverAgent or Apple XCUITest harness; not yet implemented. For widget-level access use the flutter-ultra-runtime/gesture server inside the running Flutter app.',
        };
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
      if (!(device instanceof AndroidDevice)) {
        return {
          matched: false,
          message:
            'wait_for_native_element currently supports Android only; iOS coverage tracks dump_a11y_tree which is unimplemented for iOS.',
        };
      }
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
          const xml = await device.uiautomatorDumpXml({
            timeoutMs: Math.min(15_000, deadline - Date.now()),
            signal,
          });
          const tree = parseUiautomatorXml(xml);
          const node = findNode(tree, finder);
          if (node) {
            return { matched: true, polls, node };
          }
        } catch (err) {
          // Transient device drops happen during boot — keep polling unless the
          // signal aborted us.
          if (signal.aborted) throw err;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, args.pollIntervalMs).unref?.());
      }
      return { matched: false, polls, timeoutMs: args.timeoutMs };
    },
  );
}

export const _internal = { z };
