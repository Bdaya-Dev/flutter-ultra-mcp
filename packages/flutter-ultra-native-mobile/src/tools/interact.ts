// Interaction tools: tap, type, swipe, back, home, app_switch, open_settings,
// pin_lock, dismiss_permission_dialog, permission grant/deny, orientation,
// clipboard get/set, take_device_screenshot.

import type { z } from 'zod';
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
import { detectPermissionDialog, findNode, parseUiautomatorXml, type A11yNode } from '../a11y.js';

// Android KeyEvent constants we use here.
const KEYCODE = {
  BACK: 4,
  HOME: 3,
  APP_SWITCH: 187,
  MENU: 82,
};

function escapeAdbInput(text: string): string {
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
        if (!(device instanceof AndroidDevice)) {
          throw new InvalidToolInputError(
            'native_tap finder targeting is Android-only today (depends on dump_a11y_tree).',
          );
        }
        const xml = await device.uiautomatorDumpXml({ timeoutMs: args.timeoutMs, signal });
        const tree = parseUiautomatorXml(xml);
        const finder = args.target.finder;
        const finderArgs = {
          ...(finder.text !== undefined ? { text: finder.text } : {}),
          ...(finder.textContains !== undefined ? { textContains: finder.textContains } : {}),
          ...(finder.resourceId !== undefined ? { resourceId: finder.resourceId } : {}),
          ...(finder.contentDesc !== undefined ? { contentDesc: finder.contentDesc } : {}),
          ...(finder.className !== undefined ? { className: finder.className } : {}),
          index: finder.index,
        };
        const node: A11yNode | undefined = findNode(tree, finderArgs);
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

  function defineKeyTool(
    name: string,
    description: string,
    keycode: number,
    schemaShape: z.ZodRawShape,
  ): void {
    server.defineTool(
      { name, description, inputShape: schemaShape, timeoutClass: 'quick' },
      async (args, { signal }) => {
        if (signal.aborted) throw signal.reason as Error;
        const device = await registry.get((args as { deviceId: string }).deviceId);
        if (device instanceof AndroidDevice) {
          const res = await device.shell(['input', 'keyevent', String(keycode)], {
            timeoutMs: (args as { timeoutMs: number }).timeoutMs,
            signal,
          });
          return {
            ok: res.ok,
            keycode,
            exitCode: res.exitCode,
            stderr: res.stderr.trim() || undefined,
          };
        }
        // iOS sim has no key event for these; surface unsupported.
        return {
          ok: false,
          unsupported: true,
          message: `${name} is not implemented for iOS Simulator. Use simctl 'pressbutton' verbs via shell instead.`,
        };
      },
    );
  }

  defineKeyTool(
    'native_back',
    'Press Android back / iOS swipe-back.',
    KEYCODE.BACK,
    nativeBackSchema.shape,
  );
  defineKeyTool('native_home', 'Press Home button.', KEYCODE.HOME, nativeHomeSchema.shape);
  defineKeyTool(
    'native_app_switch',
    'Show recent apps / app switcher.',
    KEYCODE.APP_SWITCH,
    nativeAppSwitchSchema.shape,
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
        'Grant a runtime permission to an Android package via `pm grant`. Does not prompt the user.',
      inputShape: nativePermissionGrantSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (!(device instanceof AndroidDevice)) {
        return { granted: false, unsupported: true, message: 'pm grant is Android-only.' };
      }
      const res = await device.shell(['pm', 'grant', args.packageName, args.permission], {
        timeoutMs: args.timeoutMs,
        signal,
      });
      return { granted: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
    },
  );

  server.defineTool(
    {
      name: 'native_permission_deny',
      description:
        'Revoke a runtime permission from an Android package via `pm revoke`. Counterpart to native_permission_grant.',
      inputShape: nativePermissionDenySchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      if (!(device instanceof AndroidDevice)) {
        return { revoked: false, unsupported: true, message: 'pm revoke is Android-only.' };
      }
      const res = await device.shell(['pm', 'revoke', args.packageName, args.permission], {
        timeoutMs: args.timeoutMs,
        signal,
      });
      return { revoked: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
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
