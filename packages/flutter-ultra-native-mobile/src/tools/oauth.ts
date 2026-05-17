// solve_oauth_in_chrome_custom_tab — plan §5.5.1.
//
// Runs the entire OAuth flow in a headless Playwright Chromium then
// dispatches the redirect URL into the app via Device.shell(). Bypasses
// CCT/SVC entirely (the app's deep-link handler can't tell the difference).

import type { FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { solveOauthSchema } from '../schemas.js';
import { solveOauthInCustomTab } from '../oauth.js';

export function registerOauthTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'solve_oauth_cct',
      description:
        'Complete an OAuth flow that the app would have opened in Chrome Custom Tabs / SafariViewController, then dispatch the auth-code redirect into the app via deep-link (adb am start / simctl openurl). The Flutter app cannot distinguish this from a real CCT redirect. Returns the auth code + full redirect URL.',
      inputShape: solveOauthSchema.shape,
      timeoutClass: 'long',
      ceilingMs: 5 * 60_000,
    },
    async (args, { signal, sendProgress }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      sendProgress({ progress: 0, message: 'launching playwright + opening authorize URL' });
      const result = await solveOauthInCustomTab({
        device,
        authorizeUrl: args.authorizeUrl,
        redirectUriPattern: args.redirectUriPattern,
        ...(args.androidPackage !== undefined ? { androidPackage: args.androidPackage } : {}),
        ...(args.fillFlow !== undefined ? { fillFlow: args.fillFlow } : {}),
        ...(args.persistProfileDir !== undefined
          ? { persistProfileDir: args.persistProfileDir }
          : {}),
        timeoutMs: args.timeoutMs,
        headless: args.headless,
        signal,
      });
      sendProgress({
        progress: 1,
        message: result.matched ? 'redirect dispatched to device' : 'no redirect matched',
      });
      return result;
    },
  );
}
