// Share sheet interaction tool: handle_share_sheet.
//
// Android: detects com.android.intentresolver / ResolverActivity via
//   `dumpsys activity top`, then reads share targets from the uiautomator
//   a11y tree and taps by label.
// iOS Simulator: detects UIActivityViewController in the WDA a11y tree and
//   reads / taps XCUIElementTypeCell nodes representing share targets.

import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { handleShareSheetSchema } from '../schemas.js';
import { findNode, parseUiautomatorXml, parseWdaSourceXml, walkTree } from '../a11y.js';

// Android activity class names that host the share / intent resolver sheet.
const ANDROID_RESOLVER_PATTERNS = [
  'com.android.intentresolver',
  'ResolverActivity',
  'ChooserActivity',
];

function isAndroidShareSheetActive(dumpsysTop: string): boolean {
  return ANDROID_RESOLVER_PATTERNS.some((p) => dumpsysTop.includes(p));
}

// Walk the uiautomator tree and collect all leaf-ish nodes that look like
// share target labels: text/contentDesc set, not a container.
function collectAndroidShareTargets(xml: string): string[] {
  const root = parseUiautomatorXml(xml);
  const labels: string[] = [];
  walkTree(root, (node) => {
    const label = node.text ?? node.contentDesc ?? '';
    if (label.trim() && node.bounds && node.clickable === true && !labels.includes(label.trim())) {
      labels.push(label.trim());
    }
    return false;
  });
  return labels;
}

// Walk WDA source XML for UIActivityViewController share target cells.
function collectIosShareTargets(xml: string): string[] {
  const root = parseWdaSourceXml(xml);
  const labels: string[] = [];
  walkTree(root, (node) => {
    if (node.className === 'XCUIElementTypeCell' || node.className === 'XCUIElementTypeButton') {
      // WDA maps XCTest label → contentDesc, name → resourceId, value → text.
      const label = node.contentDesc ?? node.text ?? '';
      if (label.trim() && !labels.includes(label.trim())) {
        labels.push(label.trim());
      }
    }
    return false;
  });
  return labels;
}

export function registerShareSheetTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'handle_share_sheet',
      description:
        'Interact with the OS share sheet. action=inspect lists available share targets without selecting. action=select taps the named target. action=dismiss closes the sheet. Android: detects com.android.intentresolver / ResolverActivity. iOS Sim: detects UIActivityViewController via WDA.',
      inputShape: handleShareSheetSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;

      if (args.action === 'select' && !args.target) {
        throw new InvalidToolInputError(
          'handle_share_sheet: target is required when action=select',
        );
      }

      const device = await registry.get(args.deviceId);

      // ── Android ──────────────────────────────────────────────────────────
      if (device instanceof AndroidDevice) {
        // 1. Verify the share sheet is open.
        const topRes = await device.shell(['dumpsys', 'activity', 'top'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        if (!topRes.ok) {
          return {
            ok: false,
            detected: false,
            reason: `dumpsys activity top failed: ${topRes.stderr.trim()}`,
          };
        }
        if (!isAndroidShareSheetActive(topRes.stdout)) {
          return { ok: false, detected: false, reason: 'no share sheet detected on Android' };
        }

        if (args.action === 'dismiss') {
          const res = await device.shell(['input', 'keyevent', '4' /* KEYCODE_BACK */], {
            timeoutMs: args.timeoutMs,
            signal,
          });
          return {
            ok: res.ok,
            detected: true,
            dismissed: res.ok,
            stderr: res.stderr.trim() || undefined,
          };
        }

        // For inspect/select we need the a11y tree.
        const xml = await device.uiautomatorDumpXml({ timeoutMs: args.timeoutMs, signal });
        const targets = collectAndroidShareTargets(xml);

        if (args.action === 'inspect') {
          return { ok: true, detected: true, targets };
        }

        // action === 'select'
        const label = args.target!;
        const node =
          findNode(parseUiautomatorXml(xml), { text: label, index: 0 }) ??
          findNode(parseUiautomatorXml(xml), { contentDesc: label, index: 0 });
        if (!node?.bounds) {
          // Try textContains as fallback.
          const fallback = findNode(parseUiautomatorXml(xml), { textContains: label, index: 0 });
          if (!fallback?.bounds) {
            return {
              ok: false,
              detected: true,
              targets,
              reason: `share target '${label}' not found in a11y tree`,
            };
          }
          const tapRes = await device.shell(
            ['input', 'tap', String(fallback.bounds.centerX), String(fallback.bounds.centerY)],
            { timeoutMs: args.timeoutMs, signal },
          );
          return {
            ok: tapRes.ok,
            detected: true,
            selected: label,
            tappedAt: { x: fallback.bounds.centerX, y: fallback.bounds.centerY },
            stderr: tapRes.stderr.trim() || undefined,
          };
        }
        const tapRes = await device.shell(
          ['input', 'tap', String(node.bounds.centerX), String(node.bounds.centerY)],
          { timeoutMs: args.timeoutMs, signal },
        );
        return {
          ok: tapRes.ok,
          detected: true,
          selected: label,
          tappedAt: { x: node.bounds.centerX, y: node.bounds.centerY },
          stderr: tapRes.stderr.trim() || undefined,
        };
      }

      // ── iOS Simulator ─────────────────────────────────────────────────────
      if (device instanceof IosSimDevice) {
        const xml = await device.wdaFetchSource(args.wdaPort, {
          timeoutMs: args.timeoutMs,
          signal,
        });

        // Detect UIActivityViewController presence.
        if (
          !xml.includes('UIActivityViewController') &&
          !xml.includes('ActivityListView') &&
          !xml.includes('ActivityContentView')
        ) {
          return { ok: false, detected: false, reason: 'no share sheet detected on iOS' };
        }

        if (args.action === 'dismiss') {
          // Tap the Cancel button that UIActivityViewController always provides.
          const root = parseWdaSourceXml(xml);
          const cancelNode =
            findNode(root, { text: 'Cancel', index: 0 }) ??
            findNode(root, { contentDesc: 'Cancel', index: 0 });
          if (cancelNode?.bounds) {
            const tapRes = await device.simctl(
              [
                'io',
                args.deviceId,
                'tap',
                String(cancelNode.bounds.centerX),
                String(cancelNode.bounds.centerY),
              ],
              { timeoutMs: args.timeoutMs, signal },
            );
            return {
              ok: tapRes.ok,
              detected: true,
              dismissed: tapRes.ok,
              stderr: tapRes.stderr.trim() || undefined,
            };
          }
          // Fallback: press home-equivalent edge swipe down.
          const swipeRes = await device.simctl(
            ['io', args.deviceId, 'swipe', '200', '700', '200', '1000'],
            { timeoutMs: args.timeoutMs, signal },
          );
          return { ok: swipeRes.ok, detected: true, dismissed: swipeRes.ok, gesture: 'swipe-down' };
        }

        const targets = collectIosShareTargets(xml);

        if (args.action === 'inspect') {
          return { ok: true, detected: true, targets };
        }

        // action === 'select'
        const label = args.target!;
        const root = parseWdaSourceXml(xml);
        const node =
          findNode(root, { contentDesc: label, index: 0 }) ??
          findNode(root, { text: label, index: 0 }) ??
          findNode(root, { textContains: label, index: 0 });
        if (!node?.bounds) {
          return {
            ok: false,
            detected: true,
            targets,
            reason: `share target '${label}' not found in WDA a11y tree`,
          };
        }
        const tapRes = await device.simctl(
          ['io', args.deviceId, 'tap', String(node.bounds.centerX), String(node.bounds.centerY)],
          { timeoutMs: args.timeoutMs, signal },
        );
        return {
          ok: tapRes.ok,
          detected: true,
          selected: label,
          tappedAt: { x: node.bounds.centerX, y: node.bounds.centerY },
          stderr: tapRes.stderr.trim() || undefined,
        };
      }

      throw new InvalidToolInputError(
        `handle_share_sheet: unsupported device kind '${device.kind}'.`,
      );
    },
  );
}
