// @flutter-ultra/flutter-ultra-native-desktop — MCP server entrypoint.
//
// Single MCP server, three OS paths. At startup we probe the running
// platform, locate the relevant sidecar binary, exchange a handshake, and
// register the 9-tool surface (plan §5.6) ONLY IF the backend reports
// healthy + permissioned. Otherwise we register zero tools and log the
// reason (AC-ND4).
//
// Worker-J (this file) owns the macOS path. Worker-I and worker-K will
// merge their Windows / Linux backends into ./backends/ post-PR; the
// registration glue is intentionally OS-agnostic.

import { createServer } from '@flutter-ultra/mcp-runtime';
import { LocalDevice } from './device/index.js';
import { MacDesktopBackend } from './backends/macos.js';
import { resolveMacHelperPath } from './sidecar/sidecarPaths.js';
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
        {
          attempted: helperPath,
        },
      );
    }
  } else if (platform === 'win32') {
    server.logger.info('windows backend owned by worker-I — pending merge');
    backend = null;
  } else if (platform === 'linux') {
    server.logger.info('linux backend owned by worker-K — pending merge');
    backend = null;
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
export type { DesktopBackend, BackendCapabilities, WindowDescriptor, A11yNode } from './types.js';
export { resolveMacHelperPath } from './sidecar/sidecarPaths.js';
export { JsonRpcClient, JsonRpcError } from './rpc/jsonRpcClient.js';
