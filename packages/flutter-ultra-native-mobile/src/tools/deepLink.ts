// Deep link dispatch tool: dispatch_deep_link.
//
// Android: `adb shell am start -a android.intent.action.VIEW -d "<uri>" [pkg]`
// iOS sim: `xcrun simctl openurl <device> "<uri>"`

import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { dispatchDeepLinkSchema } from '../schemas.js';

export function registerDeepLinkTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'dispatch_deep_link',
      description:
        'Send a URI to the device so the OS routes it to the matching app. Android: am start VIEW intent. iOS Simulator: simctl openurl. Physical iOS devices require idb and are not supported.',
      inputShape: dispatchDeepLinkSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (device instanceof AndroidDevice) {
        const argv = ['am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', args.uri];
        if (args.packageName) argv.push(args.packageName);
        const res = await device.shell(argv, { timeoutMs: args.timeoutMs, signal });
        return {
          dispatched: res.ok,
          uri: args.uri,
          ...(args.packageName ? { packageName: args.packageName } : {}),
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }

      if (device instanceof IosSimDevice) {
        const res = await device.simctl(['openurl', args.deviceId, args.uri], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          dispatched: res.ok,
          uri: args.uri,
          exitCode: res.exitCode,
          stderr: res.stderr.trim() || undefined,
        };
      }

      throw new InvalidToolInputError(
        `dispatch_deep_link: unsupported device kind '${device.kind}'. Physical iOS devices require idb.`,
      );
    },
  );
}
