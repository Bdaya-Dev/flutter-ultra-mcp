// GPS / location simulation tools: set_device_location, clear_device_location.
//
// Android emulator: `adb emu geo fix <lon> <lat> [<alt>]` (longitude first).
// iOS Simulator:    `xcrun simctl location <device> set <lat>,<lon>`.
//                   `xcrun simctl location <device> clear`.

import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { setDeviceLocationSchema, clearDeviceLocationSchema } from '../schemas.js';

export function registerLocationTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'set_device_location',
      description:
        'Inject a fake GPS location into the device. Android emulator: adb emu geo fix (longitude first). iOS Simulator: xcrun simctl location set. Physical devices are not supported.',
      inputShape: setDeviceLocationSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        // `adb emu geo fix` requires longitude before latitude.
        const argv = ['emu', 'geo', 'fix', String(args.longitude), String(args.latitude)];
        if (args.altitude !== undefined) argv.push(String(args.altitude));
        const res = await device.adb(argv, { timeoutMs: args.timeoutMs, signal });
        return {
          ok: res.ok,
          latitude: args.latitude,
          longitude: args.longitude,
          ...(args.altitude !== undefined ? { altitude: args.altitude } : {}),
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }

      if (device instanceof IosSimDevice) {
        // simctl location set uses "lat,lon" with no altitude support.
        const coord = `${String(args.latitude)},${String(args.longitude)}`;
        const res = await device.simctl(['location', args.deviceId, 'set', coord], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: res.ok,
          latitude: args.latitude,
          longitude: args.longitude,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }

      throw new InvalidToolInputError(
        `set_device_location: unsupported device kind '${device.kind}'. Physical iOS devices are not supported.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'clear_device_location',
      description:
        'Stop GPS simulation and return the device to real location data. iOS Simulator: xcrun simctl location clear. Android emulator has no explicit clear; call set_device_location with real coordinates instead.',
      inputShape: clearDeviceLocationSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        return {
          ok: false,
          unsupported: true,
          message:
            'Android emulator has no geo clear command. Set real coordinates via set_device_location to restore normal GPS behaviour.',
        };
      }

      if (device instanceof IosSimDevice) {
        const res = await device.simctl(['location', args.deviceId, 'clear'], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return { ok: res.ok, exitCode: res.exitCode, stderr: res.stderr.trim() || undefined };
      }

      throw new InvalidToolInputError(
        `clear_device_location: unsupported device kind '${device.kind}'.`,
      );
    },
  );
}
