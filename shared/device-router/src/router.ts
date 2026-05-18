import * as os from 'node:os';
import { LocalDevice } from './local-device.js';
import { WslDevice, listWslDistros } from './wsl-device.js';
import { SshDevice, listSshHosts, type SshSpec } from './ssh-device.js';
import type { Device, DeviceSummary, ConnectSpec } from './types.js';

export class DeviceRouter {
  private readonly devices = new Map<string, Device>();
  private readonly localDevice = new LocalDevice();

  constructor() {
    this.devices.set('local', this.localDevice);
  }

  get(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

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

  async listAvailable(): Promise<DeviceSummary[]> {
    const summaries: DeviceSummary[] = [
      {
        id: 'local',
        kind: 'local',
        platform: this.localDevice.platform,
        label: `Local (${os.platform()})`,
      },
    ];

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

    try {
      const sshHosts = await listSshHosts();
      for (const h of sshHosts) {
        const user = h.user ?? os.userInfo().username;
        summaries.push({
          id: `ssh:${user}@${h.host}`,
          kind: 'ssh',
          platform: 'linux',
          label: `SSH: ${user}@${h.host}${h.port ? `:${h.port}` : ''}`,
        });
      }
    } catch {
      /* no SSH config */
    }

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

  async disconnect(deviceId: string): Promise<void> {
    if (deviceId === 'local') {
      throw new Error('Cannot disconnect local device');
    }
    const device = this.devices.get(deviceId);
    if (!device) return;
    await device.close();
    this.devices.delete(deviceId);
  }

  async closeAll(): Promise<void> {
    const toClose = [...this.devices.entries()].filter(([id]) => id !== 'local');
    await Promise.allSettled(toClose.map(async ([, device]) => device.close()));
    for (const [id] of toClose) this.devices.delete(id);
  }

  connectedIds(): string[] {
    return [...this.devices.keys()];
  }
}
