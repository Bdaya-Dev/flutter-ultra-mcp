// @flutter-ultra/flutter-ultra-native-desktop — MCP server entrypoint.
//
// Single MCP server, three OS paths. At startup we probe the running
// platform, locate the relevant sidecar binary, exchange a handshake, and
// register the 9-tool surface (plan §5.6) ONLY IF the backend reports
// healthy + permissioned. Otherwise we register zero tools and log the
// reason (AC-ND4).
//
// Worker-J owns the macOS path; worker-I the Windows path; worker-K (this
// PR) the Linux path. Each backend implements DesktopBackend and slots into
// the registry switch below; the registration glue is OS-agnostic.

import { createServer } from '@flutter-ultra/mcp-runtime';
import { LocalDevice } from './device/index.js';
import { MacDesktopBackend } from './backends/macos.js';
import { LinuxDesktopBackend } from './backends/linux.js';
import {
  resolveMacHelperPath,
  resolveLinuxHelperPath,
  resolveLinuxPythonBin,
} from './sidecar/sidecarPaths.js';
import { registerDesktopTools } from './registry.js';
import type { DesktopBackend } from './types.js';

export const SERVER_NAME = 'flutter-ultra-native-desktop';
export const SERVER_VERSION = '0.0.1';

export interface CreateNativeDesktopServerOptions {
  /** Override keep-alive interval for tests (default 30s via mcp-runtime). */
  keepAliveIntervalMs?: number;
  /**
   * Override the platform detection — useful for tests that want to
   * exercise the Linux branch on a macOS dev box.
   */
  platformOverride?: NodeJS.Platform;
}

export async function createNativeDesktopServer(options: CreateNativeDesktopServerOptions = {}) {
  const server = createServer({
    info: { name: SERVER_NAME, version: SERVER_VERSION },
    ...(options.keepAliveIntervalMs !== undefined
      ? { keepAliveIntervalMs: options.keepAliveIntervalMs }
      : {}),
  });

  const platform = options.platformOverride ?? process.platform;
  const device = new LocalDevice();

  let backend: DesktopBackend | null = null;
  if (platform === 'darwin') {
    const helperPath = resolveMacHelperPath();
    server.logger.info('probing mac helper', { helperPath });
    backend = await MacDesktopBackend.create({
      device,
      helperPath,
      logger: server.logger,
    });
    if (!backend) {
      server.logger.warn(
        'no mac backend — install the Swift helper or set FLUTTER_ULTRA_MAC_HELPER',
        { attempted: helperPath },
      );
    }
  } else if (platform === 'win32') {
    server.logger.info('windows backend owned by worker-I — pending merge');
    backend = null;
  } else if (platform === 'linux') {
    const sidecarPath = resolveLinuxHelperPath();
    const pythonBin = resolveLinuxPythonBin();
    server.logger.info('probing linux at-spi sidecar', { sidecarPath, pythonBin });
    backend = await LinuxDesktopBackend.create({
      device,
      sidecarPath,
      pythonBin,
      logger: server.logger,
    });
    if (!backend) {
      server.logger.warn(
        'no linux backend — install python3-gi + gir1.2-atspi-2.0 or set FLUTTER_ULTRA_LINUX_HELPER',
        { attempted: sidecarPath },
      );
    }
  } else {
    server.logger.warn('unsupported platform — no desktop backend will register', { platform });
    backend = null;
  }

  registerDesktopTools({ server, backend });

  return {
    server,
    backend,
    async start() {
      await server.start();
    },
    async stop() {
      try {
        if (backend) await backend.shutdown();
      } catch (err) {
        server.logger.warn('backend shutdown failed', { err: String(err) });
      }
      await server.stop();
    },
  };
}

export { LocalDevice } from './device/index.js';
export type { Device, ExecOptions, ExecResult, RpcStream } from './device/index.js';
export { MacDesktopBackend, TCC_REMEDIATION, describeMacError } from './backends/macos.js';
export {
  LinuxDesktopBackend,
  describeLinuxError,
  ATSPI_BUS_REMEDIATION,
} from './backends/linux.js';
export type { DesktopBackend, BackendCapabilities, WindowDescriptor, A11yNode } from './types.js';
export {
  resolveMacHelperPath,
  resolveLinuxHelperPath,
  resolveLinuxPythonBin,
} from './sidecar/sidecarPaths.js';
export { JsonRpcClient, JsonRpcError } from './rpc/jsonRpcClient.js';
export { detectLocalDistro, detectDeviceDistro } from './platform.js';
