// Device control tools: toggle_device_wifi, toggle_airplane_mode, shake_device.
//
// Android:
//   WiFi:     `adb shell svc wifi enable|disable`
//   Airplane: `adb shell cmd connectivity airplane-mode enable|disable`
//   Shake:    `adb emu sensor set acceleration 0:0:-49` (brief spike then restore)
//
// iOS Simulator:
//   WiFi / Airplane: not available (sim shares the host NIC; no simctl for these).
//   Shake:           `xcrun simctl io <device> sendappevent UIEventTypeMotion`

import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { toggleDeviceWifiSchema, toggleAirplaneModeSchema, shakeDeviceSchema } from '../schemas.js';

export function registerDeviceControlTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'toggle_device_wifi',
      description:
        'Enable or disable WiFi on an Android device via `adb shell svc wifi`. iOS Simulator shares the host network stack and cannot toggle WiFi independently.',
      inputShape: toggleDeviceWifiSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const verb = args.enable ? 'enable' : 'disable';
        const res = await device.shell(['svc', 'wifi', verb], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          wifi: args.enable,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }

      if (device instanceof IosSimDevice) {
        return {
          ok: false,
          unsupported: true,
          message:
            'iOS Simulator shares the host network interface. WiFi cannot be toggled independently via simctl.',
        };
      }

      throw new InvalidToolInputError(
        `toggle_device_wifi: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'toggle_airplane_mode',
      description:
        'Enable or disable airplane mode on an Android device via `adb shell cmd connectivity airplane-mode`. iOS Simulator cannot toggle airplane mode.',
      inputShape: toggleAirplaneModeSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const verb = args.enable ? 'enable' : 'disable';
        const res = await device.shell(['cmd', 'connectivity', 'airplane-mode', verb], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          airplaneMode: args.enable,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }

      if (device instanceof IosSimDevice) {
        return {
          ok: false,
          unsupported: true,
          message: 'iOS Simulator does not support airplane mode toggling via simctl.',
        };
      }

      throw new InvalidToolInputError(
        `toggle_airplane_mode: unsupported device kind '${device.kind}'.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'shake_device',
      description:
        'Simulate a device shake gesture. Android emulator: brief accelerometer spike via adb emu sensor. iOS Simulator: simctl io sendappevent UIEventTypeMotion.',
      inputShape: shakeDeviceSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        // Inject a 5g spike on the X axis then restore idle (0,0,-9.8 ≈ gravity).
        // The emulator sensor console uses units of m/s², values sent as "x:y:z".
        await device.adb(['emu', 'sensor', 'set', 'acceleration', '49:0:0'], {
          timeoutMs: 2_000,
          signal,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 150).unref?.());
        const res = await device.adb(['emu', 'sensor', 'set', 'acceleration', '0:0:-9.8'], {
          timeoutMs: 2_000,
          signal,
        });
        return { ok: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }

      if (device instanceof IosSimDevice) {
        // UIEventTypeMotion = 4, UIEventSubtypeMotionShake = 1
        const res = await device.simctl(
          ['io', args.deviceId, 'sendappevent', 'UIEventTypeMotion', 'UIEventSubtypeMotionShake'],
          { timeoutMs: args.timeoutMs, signal },
        );
        return { ok: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }

      throw new InvalidToolInputError(`shake_device: unsupported device kind '${device.kind}'.`);
    },
  );
}
