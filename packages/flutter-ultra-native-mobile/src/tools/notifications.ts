// Notification tray tools: open_notification_tray, list_notifications,
// tap_notification, dismiss_notification_tray.
//
// Android:
//   Open:    `adb shell cmd statusbar expand-notifications`
//   List:    `adb shell dumpsys notification --noredact` (parse text output)
//   Tap:     open tray → dump a11y → find by index/package/text → input tap
//   Dismiss: `adb shell cmd statusbar collapse`
//
// iOS Simulator:
//   Open:    swipe down from top center (y=0 → y=300) via native_swipe helper
//   List:    unsupported (WDA notification center access not available)
//   Tap:     unsupported
//   Dismiss: swipe up or press home

import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { findNode, parseUiautomatorXml, type A11yNode } from '../a11y.js';
import {
  openNotificationTraySchema,
  listNotificationsSchema,
  tapNotificationSchema,
  dismissNotificationTraySchema,
} from '../schemas.js';

export interface ParsedNotification {
  pkg: string;
  key: string;
  title: string;
  text: string;
  when: number;
}

// Parse the text output of `dumpsys notification --noredact`.
// Each NotificationRecord block looks like:
//
//   NotificationRecord(0x...: pkg=com.example uid=... user=UserHandle{0} id=1 tag=null pri=0 ...)
//     uid=10123 userId=0
//     key=0|com.example|1|null|10123
//     ...
//     extras={
//       android.title=String (14): My Title
//       android.text=String (8): My Text
//       ...
//     }
//     postTime=1716492000000
//
export function parseDumpsysNotifications(output: string): ParsedNotification[] {
  const results: ParsedNotification[] = [];

  // Split into blocks at each NotificationRecord header.
  const blocks = output.split(/(?=NotificationRecord\()/);

  for (const block of blocks) {
    if (!block.startsWith('NotificationRecord(')) continue;

    // Extract package name from the record header.
    const pkgMatch = /\bpkg=([^\s,)]+)/.exec(block);
    if (!pkgMatch) continue;
    const pkg = pkgMatch[1]!;

    // Extract the notification key (format: userId|pkg|id|tag|uid).
    const keyMatch = /\bkey=([^\s\n]+)/.exec(block);
    const key = keyMatch ? keyMatch[1]! : '';

    // Extract postTime (epoch ms).
    const postTimeMatch = /\bpostTime=(\d+)/.exec(block);
    const when = postTimeMatch ? Number(postTimeMatch[1]) : 0;

    // Extract android.title — value follows "): " after the type annotation.
    const titleMatch = /android\.title=(?:String \(\d+\):\s*)(.+)/.exec(block);
    const title = titleMatch ? titleMatch[1]!.trim() : '';

    // Extract android.text — same pattern.
    const textMatch = /android\.text=(?:String \(\d+\):\s*)(.+)/.exec(block);
    const text = textMatch ? textMatch[1]!.trim() : '';

    results.push({ pkg, key, title, text, when });
  }

  return results;
}

export function registerNotificationTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'open_notification_tray',
      description:
        'Expand the notification tray. Android: cmd statusbar expand-notifications. iOS Simulator: swipe down from top center of screen.',
      inputShape: openNotificationTraySchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const res = await device.shell(['cmd', 'statusbar', 'expand-notifications'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { ok: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }

      if (device instanceof IosSimDevice) {
        // Swipe from top-center downward to reveal notification center.
        const res = await device.simctl(['io', args.deviceId, 'swipe', '200', '0', '200', '300'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { ok: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }

      throw new InvalidToolInputError(
        `open_notification_tray: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'list_notifications',
      description:
        'List active notifications on the device. Android: parses dumpsys notification --noredact output. iOS Simulator: unsupported (requires WebDriverAgent notification center access).',
      inputShape: listNotificationsSchema.shape,
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true },
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const res = await device.shell(['dumpsys', 'notification', '--noredact'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        if (!res.ok) {
          return {
            ok: false,
            notifications: [],
            exitCode: res.exitCode,
            stderr: res.stderr.trim() || undefined,
          };
        }
        const notifications = parseDumpsysNotifications(res.stdout);
        return { ok: true, notifications, count: notifications.length };
      }

      if (device instanceof IosSimDevice) {
        return {
          ok: false,
          unsupported: true,
          message:
            'list_notifications is not available on iOS Simulator. WebDriverAgent notification center access is required but not implemented.',
          notifications: [],
        };
      }

      throw new InvalidToolInputError(
        `list_notifications: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'tap_notification',
      description:
        'Tap a notification in the notification tray. Opens the tray first if needed, then matches the notification by index, package name, or title text, and taps its bounds center via the a11y tree. Android only; iOS Simulator is unsupported.',
      inputShape: tapNotificationSchema.shape,
      timeoutClass: 'long',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof IosSimDevice) {
        return {
          ok: false,
          unsupported: true,
          message:
            'tap_notification is not available on iOS Simulator. WebDriverAgent notification center access is required.',
        };
      }

      if (!(device instanceof AndroidDevice)) {
        throw new InvalidToolInputError(
          `tap_notification: unsupported device kind '${device.kind}'.`,
        );
      }

      // Expand the tray first.
      await device.shell(['cmd', 'statusbar', 'expand-notifications'], {
        timeoutMs: 3_000,
        signal,
      });

      // Small settle delay so the tray animation completes before dump.
      await new Promise<void>((resolve) => setTimeout(resolve, 500).unref?.());

      // Dump the a11y tree with the tray open.
      const xml = await device.uiautomatorDumpXml({ timeoutMs: args.timeoutMs, signal });
      const tree = parseUiautomatorXml(xml);

      // Build a finder from the caller's finder spec.
      const finder = args.finder;
      let node: A11yNode | undefined;

      if (finder.kind === 'index') {
        // Collect all clickable notification container nodes.
        const candidates: A11yNode[] = [];
        function collect(n: A11yNode): void {
          // Notification rows sit inside the notification shade, typically
          // with package names like com.android.systemui or the app package.
          // We match any clickable non-system node; the caller picks by index.
          if (n.clickable) candidates.push(n);
          for (const child of n.children) collect(child);
        }
        collect(tree);
        node = candidates[finder.index];
      } else if (finder.kind === 'package') {
        const pkg = finder.packageName;
        node = findNode(tree, { resourceId: pkg, index: 0 });
        if (!node) {
          // Fall back: look for any node whose packageName matches.
          function findByPkg(n: A11yNode): A11yNode | undefined {
            if (n.packageName === pkg && n.clickable) return n;
            for (const child of n.children) {
              const found = findByPkg(child);
              if (found) return found;
            }
            return undefined;
          }
          node = findByPkg(tree);
        }
      } else {
        // text match
        node = findNode(tree, { textContains: finder.text, index: 0 });
        if (!node) {
          node = findNode(tree, { contentDesc: finder.text, index: 0 });
        }
      }

      if (!node?.bounds) {
        return {
          ok: false,
          reason: 'No matching notification node found in the a11y tree.',
          finder,
        };
      }

      const { centerX, centerY } = node.bounds;
      const tapRes = await device.shell(['input', 'tap', String(centerX), String(centerY)], {
        timeoutMs: args.timeoutMs,
        signal,
      });

      return {
        ok: tapRes.ok,
        tappedAt: { x: centerX, y: centerY },
        node: {
          text: node.text,
          contentDesc: node.contentDesc,
          packageName: node.packageName,
          bounds: node.bounds,
        },
        exitCode: tapRes.exitCode,
        stderr: tapRes.stderr.trim() || undefined,
      };
    },
  );

  server.defineTool(
    {
      name: 'dismiss_notification_tray',
      description:
        'Collapse the notification tray. Android: cmd statusbar collapse. iOS Simulator: press Home or swipe up from bottom.',
      inputShape: dismissNotificationTraySchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const res = await device.shell(['cmd', 'statusbar', 'collapse'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { ok: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }

      if (device instanceof IosSimDevice) {
        // Swipe up from bottom center to dismiss notification center.
        const res = await device.simctl(['io', args.deviceId, 'swipe', '200', '300', '200', '0'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { ok: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }

      throw new InvalidToolInputError(
        `dismiss_notification_tray: unsupported device kind '${device.kind}'.`,
      );
    },
  );
}
