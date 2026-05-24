import { z } from 'zod';
import type { FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRouter, ConnectSpec } from '@flutter-ultra/device-router';
import {
  type DeviceSummary,
  type DeviceProbeResult,
  type ExecResult,
} from '@flutter-ultra/device-router';

export function registerDeviceTools(opts: {
  server: FlutterUltraServer;
  router: DeviceRouter;
}): void {
  const { server, router } = opts;

  server.defineTool(
    {
      name: 'list_devices',
      description:
        'Enumerate available devices: local host, WSL distros (Windows), SSH hosts from ~/.ssh/config. Returns device summaries without connecting.',
      timeoutClass: 'instant',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (_args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const devices: DeviceSummary[] = await router.listAvailable();
      const connected = new Set(router.connectedIds());
      return {
        devices: devices.map((d) => ({
          ...d,
          connected: connected.has(d.id),
        })),
      };
    },
  );

  server.defineTool(
    {
      name: 'connect_device',
      description:
        'Connect to a remote device (WSL distro or SSH host). Probes the device for reachability and Flutter/Dart availability. Returns probe result. After connecting, pass the device ID to other tools via deviceId parameter.',
      inputShape: {
        kind: z.enum(['wsl', 'ssh']).describe('Device type to connect'),
        distro: z.string().optional().describe('WSL distro name (required for kind=wsl)'),
        host: z.string().optional().describe('SSH hostname (required for kind=ssh)'),
        user: z.string().optional().describe('SSH username (required for kind=ssh)'),
        port: z.number().int().positive().optional().describe('SSH port (default: 22)'),
        identityFile: z.string().optional().describe('Path to SSH private key'),
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      let spec: z.infer<typeof ConnectSpec>;
      if (args.kind === 'wsl') {
        if (!args.distro) throw new Error('distro is required for WSL devices');
        spec = { kind: 'wsl', distro: args.distro };
      } else {
        if (!args.host || !args.user) throw new Error('host and user are required for SSH devices');
        spec = {
          kind: 'ssh',
          host: args.host,
          user: args.user,
          ...(args.port !== undefined ? { port: args.port } : {}),
          ...(args.identityFile !== undefined ? { identityFile: args.identityFile } : {}),
        };
      }

      const {
        device,
        probe,
      }: { device: { id: string; kind: string; platform: string }; probe: DeviceProbeResult } =
        await router.connect(spec);
      return {
        deviceId: device.id,
        kind: device.kind,
        platform: device.platform,
        probe,
      };
    },
  );

  server.defineTool(
    {
      name: 'disconnect_device',
      description:
        'Disconnect from a remote device, closing SSH ControlMaster sessions and all port forwards. Cannot disconnect the local device.',
      inputShape: {
        deviceId: z
          .string()
          .min(1)
          .describe('Device ID to disconnect (e.g. "wsl:Ubuntu" or "ssh:user@host")'),
      },
      timeoutClass: 'instant',
    },
    async (args) => {
      await router.disconnect(args.deviceId);
      return { disconnected: args.deviceId };
    },
  );

  server.defineTool(
    {
      name: 'device_exec',
      description:
        'Run an arbitrary command on a connected device. Returns stdout, stderr, and exit code. For most workflows, prefer specific tools (build_linux, launch_app) with deviceId — this is a low-level escape hatch.',
      inputShape: {
        deviceId: z.string().optional().describe('Target device (default: "local")'),
        cmd: z.array(z.string()).min(1).describe('Command and arguments'),
        cwd: z.string().optional().describe('Working directory on the device'),
        timeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds'),
      },
      timeoutClass: 'long',
    },
    async (args) => {
      const device = router.resolve(args.deviceId);
      const result: ExecResult = await device.exec(args.cmd, {
        ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
      });
      return {
        deviceId: device.id,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      };
    },
  );
}
