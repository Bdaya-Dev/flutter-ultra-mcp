// @flutter-ultra/flutter-ultra-native-mobile — MCP server entrypoint.
//
// Wires the shared mcp-runtime scaffolding to the native-mobile tool
// catalogue. Plan §5.5 + §5.5.1.
//
// Tool catalogue (17):
//   list_devices, dump_a11y_tree, wait_for_native_element,
//   native_tap, native_type, native_swipe,
//   native_back, native_home, native_app_switch, native_open_settings,
//   native_pin_lock, dismiss_permission_dialog,
//   native_permission_grant, native_permission_deny,
//   take_device_screenshot, set_device_orientation,
//   native_clipboard_set, native_clipboard_get,
//   start_device_logs, poll_device_logs, stop_device_logs,
//   solve_oauth_cct.

import { createServer } from '@flutter-ultra/mcp-runtime';
import { createDeviceRegistry, type DeviceRegistry, type RegistryOptions } from './registry.js';
import { createLogStreamService, type LogStreamService } from './logStream.js';
import { registerInspectTools } from './tools/inspect.js';
import { registerInteractTools } from './tools/interact.js';
import { registerLogTools } from './tools/logs.js';
import { registerOauthTools } from './tools/oauth.js';

export const SERVER_NAME = 'flutter-ultra-native-mobile';
export const SERVER_VERSION = '0.0.1';

export interface CreateNativeMobileServerOptions {
  keepAliveIntervalMs?: number;
  registry?: RegistryOptions;
}

export async function createNativeMobileServer(options: CreateNativeMobileServerOptions = {}) {
  const server = createServer({
    info: { name: SERVER_NAME, version: SERVER_VERSION },
    ...(options.keepAliveIntervalMs !== undefined
      ? { keepAliveIntervalMs: options.keepAliveIntervalMs }
      : {}),
  });

  const registry: DeviceRegistry = createDeviceRegistry(options.registry ?? {});
  const logStream: LogStreamService = createLogStreamService();

  registerInspectTools({ server, registry });
  registerInteractTools({ server, registry });
  registerLogTools({ server, registry, logStream });
  registerOauthTools({ server, registry });

  return {
    server,
    registry,
    logStream,
    async start() {
      await server.start();
    },
    async stop() {
      logStream.shutdown();
      await registry.shutdown();
      await server.stop();
    },
  };
}

export { createDeviceRegistry } from './registry.js';
export { createLogStreamService } from './logStream.js';
export {
  AndroidDevice,
  listAndroidDevices,
  parseAdbDevices,
  type AndroidDeviceInfo,
} from './android.js';
export {
  IosPhysicalDevice,
  IosSimDevice,
  listIosSimulators,
  listIosPhysical,
  parseSimctlDevices,
  platformGuard,
  type IosDeviceInfo,
} from './ios.js';
export {
  LocalDevice,
  spawnAwait,
  localTempPath,
  randomTempName,
  safeUnlink,
  type DeviceKind,
  type DeviceTransport,
  type ShellOptions,
  type ShellResult,
  type UploadOptions,
} from './device.js';
export {
  parseUiautomatorXml,
  findNode,
  walkTree,
  detectPermissionDialog,
  type A11yNode,
  type A11yBounds,
  type FinderSpec,
  type PermissionDialogShape,
} from './a11y.js';
export { solveOauthInCustomTab, type SolveOauthOptions, type SolveOauthResult } from './oauth.js';
