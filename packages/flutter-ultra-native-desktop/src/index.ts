#!/usr/bin/env node
// flutter-ultra-native-desktop MCP server entrypoint (Linux AT-SPI path).
//
// stdio transport. Spawns a Python AT-SPI bridge sidecar lazily on first
// tool invocation. Windows and macOS paths ship from sibling packages
// owned by workers I and J.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNativeDesktopServer } from './server.js';

export const SERVER_NAME = 'flutter-ultra-native-desktop';

export { createNativeDesktopServer } from './server.js';
export {
  LocalLinuxDevice,
  WslDevice,
  SshDevice,
  type Device,
  type DeviceKind,
  type DevicePlatform,
  type ExecOptions,
  type ExecResult,
  type SpawnOptions,
  type DeviceProcess,
  type DeviceProbeResult,
  type PortForward,
} from './device.js';
export {
  type DesktopBackend,
  type AccessibleNode,
  type WindowGroup,
  type ListWindowsResult,
  type BackendStatus,
  type FindCriteria,
  type ActionResult,
  type WaitResult,
} from './backend.js';
export { LinuxDesktopBackend } from './linux-backend.js';
export { SidecarRegistry } from './sidecar.js';
export { allTools } from './tools.js';
export { detectLocalDistro, detectDeviceDistro } from './platform.js';

async function main(): Promise<void> {
  const { server } = createNativeDesktopServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[${SERVER_NAME}] connected via stdio transport\n`);
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isDirectInvocation) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `[${SERVER_NAME}] fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
}
