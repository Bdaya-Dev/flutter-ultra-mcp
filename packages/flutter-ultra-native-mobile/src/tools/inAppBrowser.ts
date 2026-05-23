// In-app browser tools: detect_in_app_browser, interact_in_app_browser.
//
// Android Chrome Custom Tab (CCT):
//   Detection: `dumpsys activity top` — look for CustomTabActivity,
//   ChromeTabbedActivity, or com.android.chrome in the top resumed activity.
//   URL: parse the "mIntentRecord" / "mIntent" data field from dumpsys output.
//   Web content a11y: uiautomator dump — Chrome exposes WebView nodes whose
//   text/contentDesc carry web element text.
//   URL bar: resource-id "com.android.chrome:id/url_bar" in a11y tree.
//   Close: ImageButton with contentDesc "Close tab" or "Close".
//
// iOS Safari View Controller (SVC):
//   Detection: WDA source contains SFSafariViewController class.
//   URL bar / Done button are standard SVC a11y elements.
//   Web content: accessible through web content a11y nodes in WDA source.

import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { detectInAppBrowserSchema, interactInAppBrowserSchema } from '../schemas.js';
import { findNode, parseUiautomatorXml, parseWdaSourceXml } from '../a11y.js';

// Android activity / package patterns that indicate an in-app browser.
const ANDROID_CCT_PATTERNS = [
  'CustomTabActivity',
  'ChromeTabbedActivity',
  'com.android.chrome',
  'CustomTabsConnection',
  'SameTaskCustomTabActivity',
];

type BrowserType = 'cct' | 'svc' | 'none';

interface DetectionResult {
  detected: boolean;
  type: BrowserType;
  url?: string;
}

function detectAndroidBrowser(dumpsysTop: string): DetectionResult {
  const isCct = ANDROID_CCT_PATTERNS.some((p) => dumpsysTop.includes(p));
  if (!isCct) return { detected: false, type: 'none' };

  // Extract the URL from the intent data line: "mIntent{... dat=https://... }"
  // or "Data: https://..."
  const datMatch =
    /\bdat=([^\s}]+)/.exec(dumpsysTop) ??
    /\bData:\s*(\S+)/.exec(dumpsysTop) ??
    /\bdata=([^\s}]+)/.exec(dumpsysTop);
  const rawUrl = datMatch?.[1];
  const url = rawUrl && rawUrl.startsWith('http') ? rawUrl : undefined;

  return url !== undefined ? { detected: true, type: 'cct', url } : { detected: true, type: 'cct' };
}

function detectIosBrowser(wdaXml: string): DetectionResult {
  if (
    wdaXml.includes('SFSafariViewController') ||
    wdaXml.includes('SFBrowserRemoteViewController')
  ) {
    const root = parseWdaSourceXml(wdaXml);
    const urlBarNode = findNode(root, { className: 'XCUIElementTypeTextField', index: 0 });
    const candidate = urlBarNode ? (urlBarNode.text ?? urlBarNode.contentDesc ?? '') : '';
    const url = candidate.startsWith('http') ? candidate : undefined;
    return url !== undefined
      ? { detected: true, type: 'svc', url }
      : { detected: true, type: 'svc' };
  }
  return { detected: false, type: 'none' };
}

export function registerInAppBrowserTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'detect_in_app_browser',
      description:
        'Detect whether a Chrome Custom Tab (Android) or Safari View Controller (iOS) is currently active. Returns detected, type (cct/svc/none), and url if readable.',
      inputShape: detectInAppBrowserSchema.shape,
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true },
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const res = await device.shell(['dumpsys', 'activity', 'top'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        if (!res.ok) {
          return {
            detected: false,
            type: 'none' as const,
            error: `dumpsys activity top failed: ${res.stderr.trim()}`,
          };
        }
        const result = detectAndroidBrowser(res.stdout);
        return { ...result };
      }

      if (device instanceof IosSimDevice) {
        const xml = await device.wdaFetchSource(args.wdaPort, {
          timeoutMs: args.timeoutMs,
          signal,
        });
        const result = detectIosBrowser(xml);
        return { ...result };
      }

      throw new InvalidToolInputError(
        `detect_in_app_browser: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'interact_in_app_browser',
      description:
        'Interact with an active Chrome Custom Tab (Android) or Safari View Controller (iOS). action=tap taps a web content element by text. action=fill types text into the focused field. action=read_url reads the address bar URL. action=dismiss closes the browser.',
      inputShape: interactInAppBrowserSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;

      if ((args.action === 'tap' || args.action === 'fill') && !args.finder) {
        throw new InvalidToolInputError(
          `interact_in_app_browser: finder is required for action '${args.action}'`,
        );
      }
      if (args.action === 'fill' && !args.text) {
        throw new InvalidToolInputError(
          "interact_in_app_browser: text is required for action 'fill'",
        );
      }

      const device = await registry.get(args.deviceId);

      // ── Android CCT ───────────────────────────────────────────────────────
      if (device instanceof AndroidDevice) {
        // Confirm CCT is active first.
        const topRes = await device.shell(['dumpsys', 'activity', 'top'], {
          timeoutMs: Math.min(args.timeoutMs, 10_000),
          signal,
        });
        if (!topRes.ok || !detectAndroidBrowser(topRes.stdout).detected) {
          return { ok: false, reason: 'no Chrome Custom Tab detected on Android' };
        }

        if (args.action === 'read_url') {
          // Read URL bar from a11y tree: resource-id "com.android.chrome:id/url_bar"
          const xml = await device.uiautomatorDumpXml({ timeoutMs: args.timeoutMs, signal });
          const root = parseUiautomatorXml(xml);
          const urlBarNode =
            findNode(root, { resourceId: 'com.android.chrome:id/url_bar', index: 0 }) ??
            findNode(root, { resourceId: 'com.android.chrome:id/location_bar', index: 0 });
          const url = urlBarNode?.text ?? urlBarNode?.contentDesc ?? '';
          return { ok: true, url: url || undefined };
        }

        if (args.action === 'dismiss') {
          // Tap the "Close tab" button in the CCT toolbar.
          const xml = await device.uiautomatorDumpXml({ timeoutMs: args.timeoutMs, signal });
          const root = parseUiautomatorXml(xml);
          const closeNode =
            findNode(root, { contentDesc: 'Close tab', index: 0 }) ??
            findNode(root, { contentDesc: 'Close', index: 0 }) ??
            findNode(root, { resourceId: 'com.android.chrome:id/close_button', index: 0 });
          if (closeNode?.bounds) {
            const tapRes = await device.shell(
              ['input', 'tap', String(closeNode.bounds.centerX), String(closeNode.bounds.centerY)],
              { timeoutMs: args.timeoutMs, signal },
            );
            return {
              ok: tapRes.ok,
              dismissed: tapRes.ok,
              tappedAt: { x: closeNode.bounds.centerX, y: closeNode.bounds.centerY },
              stderr: tapRes.stderr.trim() || undefined,
            };
          }
          // Fallback: press back.
          const backRes = await device.shell(['input', 'keyevent', '4'], {
            timeoutMs: args.timeoutMs,
            signal,
          });
          return { ok: backRes.ok, dismissed: backRes.ok, method: 'keycode-back' };
        }

        // tap / fill — find web content node by text in the a11y tree.
        const xml = await device.uiautomatorDumpXml({ timeoutMs: args.timeoutMs, signal });
        const root = parseUiautomatorXml(xml);
        const finder = args.finder!;
        const node =
          findNode(root, { text: finder, index: 0 }) ??
          findNode(root, { contentDesc: finder, index: 0 }) ??
          findNode(root, { textContains: finder, index: 0 });
        if (!node?.bounds) {
          return { ok: false, reason: `element '${finder}' not found in CCT a11y tree` };
        }

        const tapRes = await device.shell(
          ['input', 'tap', String(node.bounds.centerX), String(node.bounds.centerY)],
          { timeoutMs: args.timeoutMs, signal },
        );
        if (!tapRes.ok || args.action === 'tap') {
          return {
            ok: tapRes.ok,
            tapped: tapRes.ok,
            finder,
            tappedAt: { x: node.bounds.centerX, y: node.bounds.centerY },
            stderr: tapRes.stderr.trim() || undefined,
          };
        }

        // fill: tap placed focus, now type.
        const escaped = args.text!.replace(/'/g, `'"'"'`);
        const typeRes = await device.shell(['sh', '-c', `input text '${escaped}'`], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: typeRes.ok,
          filled: typeRes.ok,
          finder,
          length: args.text!.length,
          stderr: typeRes.stderr.trim() || undefined,
        };
      }

      // ── iOS SVC ───────────────────────────────────────────────────────────
      if (device instanceof IosSimDevice) {
        const xml = await device.wdaFetchSource(args.wdaPort, {
          timeoutMs: args.timeoutMs,
          signal,
        });
        if (!detectIosBrowser(xml).detected) {
          return { ok: false, reason: 'no Safari View Controller detected on iOS' };
        }
        const root = parseWdaSourceXml(xml);

        if (args.action === 'read_url') {
          const urlBarNode = findNode(root, { className: 'XCUIElementTypeTextField', index: 0 });
          const url = urlBarNode?.text ?? urlBarNode?.contentDesc ?? '';
          return { ok: true, url: url || undefined };
        }

        if (args.action === 'dismiss') {
          const doneNode =
            findNode(root, { text: 'Done', index: 0 }) ??
            findNode(root, { contentDesc: 'Done', index: 0 });
          if (doneNode?.bounds) {
            const tapRes = await device.simctl(
              [
                'io',
                args.deviceId,
                'tap',
                String(doneNode.bounds.centerX),
                String(doneNode.bounds.centerY),
              ],
              { timeoutMs: args.timeoutMs, signal },
            );
            return {
              ok: tapRes.ok,
              dismissed: tapRes.ok,
              tappedAt: { x: doneNode.bounds.centerX, y: doneNode.bounds.centerY },
              stderr: tapRes.stderr.trim() || undefined,
            };
          }
          return { ok: false, reason: 'Done button not found in SVC a11y tree' };
        }

        // tap / fill.
        const finder = args.finder!;
        const node =
          findNode(root, { text: finder, index: 0 }) ??
          findNode(root, { contentDesc: finder, index: 0 }) ??
          findNode(root, { textContains: finder, index: 0 });
        if (!node?.bounds) {
          return { ok: false, reason: `element '${finder}' not found in SVC a11y tree` };
        }

        const tapRes = await device.simctl(
          ['io', args.deviceId, 'tap', String(node.bounds.centerX), String(node.bounds.centerY)],
          { timeoutMs: args.timeoutMs, signal },
        );
        if (!tapRes.ok || args.action === 'tap') {
          return {
            ok: tapRes.ok,
            tapped: tapRes.ok,
            finder,
            tappedAt: { x: node.bounds.centerX, y: node.bounds.centerY },
            stderr: tapRes.stderr.trim() || undefined,
          };
        }

        // fill: type after tap.
        const typeRes = await device.simctl(['io', args.deviceId, 'text', args.text!], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: typeRes.ok,
          filled: typeRes.ok,
          finder,
          length: args.text!.length,
          stderr: typeRes.stderr.trim() || undefined,
        };
      }

      throw new InvalidToolInputError(
        `interact_in_app_browser: unsupported device kind '${device.kind}'.`,
      );
    },
  );
}
