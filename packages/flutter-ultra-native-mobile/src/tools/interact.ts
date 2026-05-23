// Interaction tools: tap, type, swipe, back, home, app_switch, open_settings,
// pin_lock, dismiss_permission_dialog, permission grant/deny, orientation,
// clipboard get/set, take_device_screenshot.

import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import {
  nativeTapSchema,
  nativeTypeSchema,
  nativeSwipeSchema,
  nativeBackSchema,
  nativeHomeSchema,
  nativeAppSwitchSchema,
  nativeOpenSettingsSchema,
  nativePinLockSchema,
  dismissPermissionDialogSchema,
  nativePermissionGrantSchema,
  nativePermissionDenySchema,
  takeDeviceScreenshotSchema,
  setDeviceOrientationSchema,
  clipboardSetSchema,
  clipboardGetSchema,
} from '../schemas.js';
import {
  detectPermissionDialog,
  findNode,
  parseUiautomatorXml,
  parseWdaSourceXml,
  type A11yNode,
} from '../a11y.js';

// Android KeyEvent constants we use here.
const KEYCODE = {
  BACK: 4,
  HOME: 3,
  APP_SWITCH: 187,
  MENU: 82,
};

export function escapeAdbInput(text: string): string {
  // `adb shell input text` is brittle with special characters. Wrap in
  // single quotes and escape any embedded single-quote: ' → '"'"'.
  return text.replace(/'/g, `'"'"'`);
}

export function registerInteractTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'native_tap',
      description:
        'Tap at screen coordinates or at the bounds-center of a matched a11y node. For Android: input tap. For iOS sim: simctl io tap.',
      inputShape: nativeTapSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      let x: number;
      let y: number;
      if (args.target.kind === 'coords') {
        x = args.target.x;
        y = args.target.y;
      } else {
        const finder = args.target.finder;
        const finderArgs = {
          ...(finder.text !== undefined ? { text: finder.text } : {}),
          ...(finder.textContains !== undefined ? { textContains: finder.textContains } : {}),
          ...(finder.resourceId !== undefined ? { resourceId: finder.resourceId } : {}),
          ...(finder.contentDesc !== undefined ? { contentDesc: finder.contentDesc } : {}),
          ...(finder.className !== undefined ? { className: finder.className } : {}),
          index: finder.index,
        };
        let node: A11yNode | undefined;
        if (device instanceof AndroidDevice) {
          const xml = await device.uiautomatorDumpXml({ timeoutMs: args.timeoutMs, signal });
          node = findNode(parseUiautomatorXml(xml), finderArgs);
        } else if (device instanceof IosSimDevice) {
          // wdaPort is not on nativeTapSchema — default to 8100.
          const xml = await device.wdaFetchSource(8100, { timeoutMs: args.timeoutMs, signal });
          node = findNode(parseWdaSourceXml(xml), finderArgs);
        } else {
          throw new InvalidToolInputError(
            `native_tap finder: unsupported device kind '${device.kind}'.`,
          );
        }
        if (!node || !node.bounds) {
          return { tapped: false, reason: 'finder did not match a node with bounds' };
        }
        x = node.bounds.centerX;
        y = node.bounds.centerY;
      }
      if (device instanceof AndroidDevice) {
        const res = await device.shell(['input', 'tap', String(x), String(y)], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          tapped: res.ok,
          x,
          y,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      if (device instanceof IosSimDevice) {
        // simctl io booted tap doesn't exist in simctl directly; we send via
        // simctl tap subcommand (Xcode 15+) and fall back to "spawn IOHIDEvent".
        const res = await device.simctl(['io', args.deviceId, 'tap', String(x), String(y)], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          tapped: res.ok,
          x,
          y,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      throw new InvalidToolInputError(`native_tap: unsupported device kind '${device.kind}'.`);
    },
  );

  server.defineTool(
    {
      name: 'native_type',
      description:
        'Send text into the focused input. Android: input text (escaped). iOS sim: simctl io text.',
      inputShape: nativeTypeSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        if (args.clearFirst) {
          // Move to end of field then delete 100 chars; cheaper than computing
          // exact length from a11y dump.
          await device.shell(['input', 'keyevent', '123'], { timeoutMs: 5_000, signal }); // MOVE_END
          await device.shell(['input', 'keyevent', '--longpress', ...new Array(50).fill('67')], {
            timeoutMs: 10_000,
            signal,
          });
        }
        const escaped = escapeAdbInput(args.text);
        const res = await device.shell(['sh', '-c', `input text '${escaped}'`], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          typed: res.ok,
          length: args.text.length,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      if (device instanceof IosSimDevice) {
        const res = await device.simctl(['io', args.deviceId, 'text', args.text], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          typed: res.ok,
          length: args.text.length,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      throw new InvalidToolInputError(`native_type: unsupported device kind '${device.kind}'.`);
    },
  );

  server.defineTool(
    {
      name: 'native_swipe',
      description: 'Swipe between two coordinates. Android: input swipe. iOS sim: simctl io swipe.',
      inputShape: nativeSwipeSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        const res = await device.shell(
          [
            'input',
            'swipe',
            String(args.fromX),
            String(args.fromY),
            String(args.toX),
            String(args.toY),
            String(args.durationMs),
          ],
          { timeoutMs: args.timeoutMs, signal },
        );
        return { swiped: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }
      if (device instanceof IosSimDevice) {
        const res = await device.simctl(
          [
            'io',
            args.deviceId,
            'swipe',
            String(args.fromX),
            String(args.fromY),
            String(args.toX),
            String(args.toY),
          ],
          { timeoutMs: args.timeoutMs, signal },
        );
        return { swiped: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }
      throw new InvalidToolInputError(`native_swipe: unsupported device kind '${device.kind}'.`);
    },
  );

  server.defineTool(
    {
      name: 'native_back',
      description:
        'Press the Back button (Android) or trigger a swipe-back edge gesture (iOS Simulator via simctl io pressButton).',
      inputShape: nativeBackSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        const res = await device.shell(['input', 'keyevent', String(KEYCODE.BACK)], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          keycode: KEYCODE.BACK,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      if (device instanceof IosSimDevice) {
        // iOS has no universal back button. Simulate a left-edge swipe gesture
        // (from x=1 to x=100 at vertical midpoint) which triggers navigation
        // pop in apps using UINavigationController / Flutter Navigator.
        const res = await device.simctl(['io', args.deviceId, 'swipe', '1', '400', '100', '400'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          gesture: 'edge-swipe-back',
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      throw new InvalidToolInputError(`native_back: unsupported device kind '${device.kind}'.`);
    },
  );

  server.defineTool(
    {
      name: 'native_home',
      description:
        'Press the Home button. Android: KEYCODE_HOME. iOS Simulator: xcrun simctl io pressButton home.',
      inputShape: nativeHomeSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        const res = await device.shell(['input', 'keyevent', String(KEYCODE.HOME)], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          keycode: KEYCODE.HOME,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      if (device instanceof IosSimDevice) {
        const res = await device.pressButton('home', { timeoutMs: args.timeoutMs, signal });
        return {
          ok: res.ok,
          button: 'home',
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      throw new InvalidToolInputError(`native_home: unsupported device kind '${device.kind}'.`);
    },
  );

  server.defineTool(
    {
      name: 'native_app_switch',
      description:
        'Show the recent-apps / app-switcher UI. Android: KEYCODE_APP_SWITCH. iOS Simulator: double-tap Home (two consecutive simctl io pressButton home calls).',
      inputShape: nativeAppSwitchSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        const res = await device.shell(['input', 'keyevent', String(KEYCODE.APP_SWITCH)], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          keycode: KEYCODE.APP_SWITCH,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      if (device instanceof IosSimDevice) {
        // App switcher on iOS: swipe up and hold from the bottom of the screen.
        // simctl io swipe from bottom-center upward halfway then hold (achieved
        // via a slow swipe with no pressButton equivalent for app-switcher).
        const res = await device.simctl(
          ['io', args.deviceId, 'swipe', '200', '800', '200', '400'],
          { timeoutMs: args.timeoutMs, signal },
        );
        return {
          ok: res.ok,
          gesture: 'swipe-up-hold',
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }
      throw new InvalidToolInputError(
        `native_app_switch: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'native_open_settings',
      description: 'Open the device system settings app.',
      inputShape: nativeOpenSettingsSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        const res = await device.shell(['am', 'start', '-a', 'android.settings.SETTINGS'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { opened: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }
      if (device instanceof IosSimDevice) {
        const res = await device.openUrl('App-prefs:');
        return { opened: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }
      throw new InvalidToolInputError(
        `native_open_settings: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'native_pin_lock',
      description:
        'Toggle Android screen-pinning (lock task) on the current foreground task. Useful for kiosk-mode testing. iOS unsupported (no equivalent runtime API).',
      inputShape: nativePinLockSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (!(device instanceof AndroidDevice)) {
        return { ok: false, unsupported: true, message: 'native_pin_lock is Android-only.' };
      }
      if (args.enable) {
        // `am task lock` doesn't exist generically; we use the activity-manager
        // start-locked-task verb if present, otherwise document the limitation.
        // The reliable path is to set lock_task_features then call startLockTask
        // from inside the app — outside our scope. Surface honest failure.
        const res = await device.shell(['cmd', 'activity', 'task', 'lock'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          stderr: res.stderr.trim() || undefined,
          note: 'Some Android versions require startLockTask() from the app or device-owner setup. Inspect stderr if this fails.',
        };
      }
      const res = await device.shell(['cmd', 'activity', 'task', 'unlock'], {
        timeoutMs: args.timeoutMs,
        signal,
      });
      return { ok: res.ok, stderr: res.stderr.trim() || undefined };
    },
  );

  server.defineTool(
    {
      name: 'dismiss_permission_dialog',
      description:
        'Detect an active Android runtime permission dialog (com.android.permissioncontroller) and tap the Allow / Deny button by intent.',
      inputShape: dismissPermissionDialogSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (!(device instanceof AndroidDevice)) {
        return {
          dismissed: false,
          unsupported: true,
          message:
            'dismiss_permission_dialog targets Android permission controller; iOS uses notification settings.',
        };
      }
      const xml = await device.uiautomatorDumpXml({ timeoutMs: args.timeoutMs, signal });
      const tree = parseUiautomatorXml(xml);
      const shape = detectPermissionDialog(tree);
      if (!shape) {
        return { dismissed: false, reason: 'no permission dialog detected' };
      }
      const target = args.intent === 'allow' ? shape.allow : shape.deny;
      if (!target?.bounds) {
        return {
          dismissed: false,
          reason: `permission dialog detected but no ${args.intent} button found`,
          dialog: shape,
        };
      }
      const tapRes = await device.shell(
        ['input', 'tap', String(target.bounds.centerX), String(target.bounds.centerY)],
        { timeoutMs: args.timeoutMs, signal },
      );
      return {
        dismissed: tapRes.ok,
        intent: args.intent,
        tappedAt: { x: target.bounds.centerX, y: target.bounds.centerY },
        stderr: tapRes.stderr.trim() || undefined,
      };
    },
  );

  server.defineTool(
    {
      name: 'native_permission_grant',
      description:
        'Grant a runtime permission without a UI prompt. Android: `pm grant <packageName> <permission>`. iOS Simulator: `xcrun simctl privacy <udid> grant <service> <bundleId>` — service examples: camera, microphone, photos, location, contacts, calendar, reminders, all.',
      inputShape: nativePermissionGrantSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        const res = await device.shell(['pm', 'grant', args.packageName, args.permission], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { granted: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }
      if (device instanceof IosSimDevice) {
        const res = await device.simctlPrivacy('grant', args.permission, args.packageName, {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { granted: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }
      throw new InvalidToolInputError(
        `native_permission_grant: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'native_permission_deny',
      description:
        'Revoke a runtime permission. Android: `pm revoke <packageName> <permission>`. iOS Simulator: `xcrun simctl privacy <udid> revoke <service> <bundleId>`.',
      inputShape: nativePermissionDenySchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        const res = await device.shell(['pm', 'revoke', args.packageName, args.permission], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { revoked: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }
      if (device instanceof IosSimDevice) {
        const res = await device.simctlPrivacy('revoke', args.permission, args.packageName, {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { revoked: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }
      throw new InvalidToolInputError(
        `native_permission_deny: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'take_device_screenshot',
      description:
        'Capture a PNG screenshot of the device screen. Returns base64-encoded PNG via image content.',
      inputShape: takeDeviceScreenshotSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      let png: Buffer;
      if (device instanceof AndroidDevice) {
        png = await device.screencapPng({ signal, timeoutMs: args.timeoutMs });
      } else if (device instanceof IosSimDevice) {
        png = await device.screenshotPng({ signal, timeoutMs: args.timeoutMs });
      } else {
        throw new InvalidToolInputError(
          `take_device_screenshot: unsupported device kind '${device.kind}'.`,
        );
      }
      return {
        content: [
          {
            type: 'image',
            data: png.toString('base64'),
            mimeType: 'image/png',
          },
          {
            type: 'text',
            text: JSON.stringify({
              deviceId: args.deviceId,
              bytes: png.byteLength,
              capturedAt: new Date().toISOString(),
            }),
          },
        ],
        structuredContent: {
          deviceId: args.deviceId,
          bytes: png.byteLength,
        },
      };
    },
  );

  server.defineTool(
    {
      name: 'set_device_orientation',
      description:
        'Lock screen orientation to portrait or landscape. Android: settings put system + content insert. iOS sim: simctl io orientation.',
      inputShape: setDeviceOrientationSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        // Disable accelerometer rotation then set user_rotation.
        await device.shell(['settings', 'put', 'system', 'accelerometer_rotation', '0'], {
          timeoutMs: 5_000,
          signal,
        });
        const value = args.orientation === 'portrait' ? '0' : '1';
        const res = await device.shell(['settings', 'put', 'system', 'user_rotation', value], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          orientation: args.orientation,
          stderr: res.stderr.trim() || undefined,
        };
      }
      if (device instanceof IosSimDevice) {
        const res = await device.simctl(['io', args.deviceId, 'orientation', args.orientation], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          orientation: args.orientation,
          stderr: res.stderr.trim() || undefined,
        };
      }
      throw new InvalidToolInputError(
        `set_device_orientation: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'native_clipboard_set',
      description:
        'Set device clipboard contents. Android: `cmd clipboard set-text`. iOS sim: simctl pbcopy.',
      inputShape: clipboardSetSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        const escaped = escapeAdbInput(args.text);
        const res = await device.shell(['sh', '-c', `cmd clipboard set-text '${escaped}'`], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { ok: res.ok, length: args.text.length, stderr: res.stderr.trim() || undefined };
      }
      if (device instanceof IosSimDevice) {
        const res = await device.simctl(['pbcopy', args.deviceId], {
          input: args.text,
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { ok: res.ok, length: args.text.length, stderr: res.stderr.trim() || undefined };
      }
      throw new InvalidToolInputError(
        `native_clipboard_set: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'native_clipboard_get',
      description:
        'Read device clipboard contents. Android: `cmd clipboard get-text` (requires API 29+). iOS sim: simctl pbpaste.',
      inputShape: clipboardGetSchema.shape,
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true },
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (device instanceof AndroidDevice) {
        const res = await device.shell(['cmd', 'clipboard', 'get-text'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          text: res.ok ? res.stdout : '',
          stderr: res.stderr.trim() || undefined,
        };
      }
      if (device instanceof IosSimDevice) {
        const res = await device.simctl(['pbpaste', args.deviceId], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          text: res.ok ? res.stdout : '',
          stderr: res.stderr.trim() || undefined,
        };
      }
      throw new InvalidToolInputError(
        `native_clipboard_get: unsupported device kind '${device.kind}'.`,
      );
    },
  );
}
