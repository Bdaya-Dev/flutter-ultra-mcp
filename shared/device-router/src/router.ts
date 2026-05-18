import * as os from 'node:os';
import { LocalDevice } from './local-device.js';
import { WslDevice, listWslDistros } from './wsl-device.js';
import { SshDevice, listSshHosts, type SshSpec } from './ssh-device.js';
import type { Device, DeviceSummary, ConnectSpec } from './types.js';

/**
 * Central device registry. Discovers available devices, manages connections,
 * and resolves device IDs to Device instances.
 */
export class DeviceRouter {
  private readonly devices = new Map<string, Device>();
  private readonly localDevice = new LocalDevice();

  constructor() {
    this.devices.set('local', this.localDevice);
  }

  /** Resolve a device by ID. Returns undefined if not connected. */
  get(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

  /** Resolve a device, defaulting to local if no ID provided. */
  resolve(deviceId?: string): Device {
    const id = deviceId ?? 'local';
    const device = this.devices.get(id);
    if (!device) {
      throw new Error(
        `Device "${id}" not connected. Call connect_device first, or use list_devices to see available devices.`,
      );
    }
    return device;
  }

  /**
   * Enumerate available devices without connecting.
   * - Always includes 'local'
   * - On Windows, includes WSL distros
   * - Includes SSH hosts from ~/.ssh/config
   */
  async listAvailable(): Promise<DeviceSummary[]> {
    const summaries: DeviceSummary[] = [
      {
        id: 'local',
        kind: 'local',
        platform: this.localDevice.platform,
        label: `Local (${os.platform()})`,
      },
    ];

    // WSL discovery (Windows only)
    if (os.platform() === 'win32') {
      try {
        const distros = await listWslDistros();
        for (const distro of distros) {
          summaries.push({
            id: `wsl:${distro}`,
            kind: 'wsl',
            platform: 'linux',
            label: `WSL: ${distro}`,
          });
        }
      } catch {
        /* WSL not available */
      }
    }

    // SSH host discovery
    try {
      const sshHosts = await listSshHosts();
      for (const h of sshHosts) {
        const user = h.user ?? os.userInfo().username;
        summaries.push({
          id: `ssh:${user}@${h.host}`,
          kind: 'ssh',
          platform: 'linux', // resolved on probe()
          label: `SSH: ${user}@${h.host}${h.port ? `:${h.port}` : ''}`,
        });
      }
    } catch {
      /* no SSH config */
    }

    // Include already-connected devices not in discovery
    for (const [id, device] of this.devices) {
      if (!summaries.some((s) => s.id === id)) {
        summaries.push({
          id,
          kind: device.kind,
          platform: device.platform,
          label: id,
        });
      }
    }

    return summaries;
  }

  /**
   * Connect to a device. Creates the Device, probes it, and stores it.
   * Returns the probe result.
   */
  async connect(
    spec: ConnectSpec,
  ): Promise<{ device: Device; probe: Awaited<ReturnType<Device['probe']>> }> {
    let device: Device;

    if (spec.kind === 'wsl') {
      device = new WslDevice(spec.distro);
    } else {
      const sshSpec: SshSpec = {
        host: spec.host,
        user: spec.user,
        port: spec.port,
        identityFile: spec.identityFile,
      };
      device = new SshDevice(sshSpec);
    }

    const probeResult = await device.probe();

    if (!probeResult.reachable) {
      await device.close();
      throw new Error(`Device unreachable: ${probeResult.errors.join('; ')}`);
    }

    this.devices.set(device.id, device);
    return { device, probe: probeResult };
  }

  /** Disconnect a device by ID. */
  async disconnect(deviceId: string): Promise<void> {
    if (deviceId === 'local') {
      throw new Error('Cannot disconnect local device');
    }
    const device = this.devices.get(deviceId);
    if (!device) return;
    await device.close();
    this.devices.delete(deviceId);
  }

  /** Disconnect all non-local devices. */
  async closeAll(): Promise<void> {
    const toClose = [...this.devices.entries()].filter(([id]) => id !== 'local');
    await Promise.allSettled(toClose.map(async ([, device]) => device.close()));
    for (const [id] of toClose) this.devices.delete(id);
  }

  /** Get all currently connected device IDs. */
  connectedIds(): string[] {
    return [...this.devices.keys()];
  }
}
