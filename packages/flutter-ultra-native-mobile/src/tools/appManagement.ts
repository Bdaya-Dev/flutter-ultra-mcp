// App management tools: install_app, uninstall_app, clear_app_data, list_installed_apps.
//
// Android: adb install / adb uninstall / pm clear / pm list packages
// iOS sim: xcrun simctl install / xcrun simctl uninstall / xcrun simctl listapps

import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import {
  installAppSchema,
  uninstallAppSchema,
  clearAppDataSchema,
  listInstalledAppsSchema,
} from '../schemas.js';

export function registerAppManagementTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'install_app',
      description:
        'Install an app onto the device. Android: adb install <apk>. iOS Simulator: simctl install <device> <app-bundle>.',
      inputShape: installAppSchema.shape,
      timeoutClass: 'long',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const res = await device.adb(['install', '-r', args.apkOrIpaPath], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          installed: res.ok,
          path: args.apkOrIpaPath,
          exitCode: res.exitCode,
          stdout: res.stdout.trim() || undefined,
          stderr: res.stderr.trim() || undefined,
        };
      }

      if (device instanceof IosSimDevice) {
        const res = await device.simctl(['install', args.deviceId, args.apkOrIpaPath], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          installed: res.ok,
          path: args.apkOrIpaPath,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }

      throw new InvalidToolInputError(
        `install_app: unsupported device kind '${device.kind}'. Physical iOS installation requires idb or ios-deploy.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'uninstall_app',
      description:
        'Uninstall an app from the device. Android: adb uninstall <package>. iOS Simulator: simctl uninstall <device> <bundle-id>.',
      inputShape: uninstallAppSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const res = await device.adb(['uninstall', args.packageName], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          uninstalled: res.ok,
          packageName: args.packageName,
          exitCode: res.exitCode,
          stdout: res.stdout.trim() || undefined,
          stderr: res.stderr.trim() || undefined,
        };
      }

      if (device instanceof IosSimDevice) {
        const res = await device.simctl(['uninstall', args.deviceId, args.packageName], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          uninstalled: res.ok,
          packageName: args.packageName,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }

      throw new InvalidToolInputError(`uninstall_app: unsupported device kind '${device.kind}'.`);
    },
  );

  server.defineTool(
    {
      name: 'clear_app_data',
      description:
        'Clear all data and cache for an Android app package via `pm clear`. iOS Simulator has no equivalent (uninstall + reinstall is the alternative).',
      inputShape: clearAppDataSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (!(device instanceof AndroidDevice)) {
        return {
          ok: false,
          unsupported: true,
          message:
            'clear_app_data uses `pm clear` which is Android-only. For iOS Simulator, uninstall and reinstall the app to reset its state.',
        };
      }

      const res = await device.shell(['pm', 'clear', args.packageName], {
        timeoutMs: args.timeoutMs,
        signal,
      });
      return {
        ok: res.ok,
        packageName: args.packageName,
        exitCode: res.exitCode,
        stdout: res.stdout.trim() || undefined,
        stderr: res.stderr.trim() || undefined,
      };
    },
  );

  server.defineTool(
    {
      name: 'list_installed_apps',
      description:
        'List apps installed on the device. Android: pm list packages. iOS Simulator: simctl listapps (returns bundle IDs + display names).',
      inputShape: listInstalledAppsSchema.shape,
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true },
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const flags = args.includeSystem ? [] : ['-3'];
        const res = await device.shell(['pm', 'list', 'packages', ...flags], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        if (!res.ok) {
          return { ok: false, packages: [], exitCode: res.exitCode, stderr: res.stderr.trim() };
        }
        const packages = res.stdout
          .split(/\r?\n/)
          .map((l) => l.replace(/^package:/, '').trim())
          .filter(Boolean);
        return { ok: true, count: packages.length, packages };
      }

      if (device instanceof IosSimDevice) {
        const res = await device.simctl(['listapps', args.deviceId], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        if (!res.ok) {
          return { ok: false, packages: [], exitCode: res.exitCode, stderr: res.stderr.trim() };
        }
        // simctl listapps returns a plist; extract CFBundleIdentifier lines for portability.
        const bundleIds = [...res.stdout.matchAll(/CFBundleIdentifier\s*=\s*"([^"]+)"/g)].map(
          (m) => m[1],
        );
        return { ok: true, count: bundleIds.length, packages: bundleIds };
      }

      throw new InvalidToolInputError(
        `list_installed_apps: unsupported device kind '${device.kind}'.`,
      );
    },
  );
}
