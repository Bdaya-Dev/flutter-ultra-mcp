// DeviceRegistry — per-process cache of resolved Device handles.
//
// Tools call registry.get(deviceId) instead of constructing AndroidDevice /
// IosSimDevice directly so a future SshDevice path can intercept the
// "physical device on remote host" case before falling through to local adb.

import {
  AndroidDevice,
  listAndroidDevices,
  parseAdbDevices,
  type AndroidDeviceInfo,
} from './android.js';
import {
  IosPhysicalDevice,
  IosSimDevice,
  listIosPhysical,
  listIosSimulators,
  parseSimctlDevices,
  type IosDeviceInfo,
  type SimctlDevicesJson,
} from './ios.js';
import type { DeviceTransport } from './device.js';
import {
  SshTransport,
  parseSshConfigFromEnv,
  createSshExecFn,
  type SshConfig,
  type ExecFn,
} from './ssh.js';

export interface RegistryOptions {
  adbPath?: string;
  xcrunPath?: string;
  iosCliPath?: string;
  sshConfig?: SshConfig;
}

export interface CombinedDeviceInfo {
  id: string;
  platform: 'android' | 'ios-sim' | 'ios-real';
  state: string;
  name?: string;
  meta?: Record<string, string | undefined>;
}

export interface DeviceRegistry {
  list(): Promise<CombinedDeviceInfo[]>;
  get(deviceId: string): Promise<DeviceTransport>;
  getAndroid(udid: string): Promise<AndroidDevice>;
  getIosSim(udid: string): Promise<IosSimDevice>;
  getIosPhysical(udid: string): Promise<IosPhysicalDevice>;
  invalidate(deviceId?: string): void;
  shutdown(): Promise<void>;
}

export function createDeviceRegistry(options: RegistryOptions = {}): DeviceRegistry {
  const cache = new Map<string, DeviceTransport>();
  const adbPath = options.adbPath ?? process.env.FLUTTER_ULTRA_ADB ?? 'adb';
  const xcrunPath = options.xcrunPath ?? process.env.FLUTTER_ULTRA_XCRUN ?? 'xcrun';
  const iosCliPath =
    options.iosCliPath ??
    process.env.FLUTTER_ULTRA_GO_IOS_BIN ??
    process.env.FLUTTER_ULTRA_IOS_CLI ??
    'ios';

  const sshConfig = options.sshConfig ?? parseSshConfigFromEnv();
  const sshTransport = sshConfig ? new SshTransport(sshConfig) : undefined;
  const sshExecFn: ExecFn | undefined = sshTransport ? createSshExecFn(sshTransport) : undefined;

  // Track which device IDs were discovered via SSH so get() can recreate them.
  const sshAndroidUdids = new Set<string>();
  const sshIosSimUdids = new Set<string>();

  let cachedAndroid: AndroidDeviceInfo[] | null = null;
  let cachedIosSim: IosDeviceInfo[] | null = null;
  let cachedIosReal: IosDeviceInfo[] | null = null;
  let lastEnumeratedAt = 0;
  const ENUMERATION_TTL_MS = 5_000;

  async function sshEnumerate(): Promise<{
    android: AndroidDeviceInfo[];
    iosSim: IosDeviceInfo[];
  }> {
    if (!sshTransport) return { android: [], iosSim: [] };

    const [adbRes, simctlRes] = await Promise.all([
      sshTransport.exec(['adb', 'devices', '-l'], { timeoutMs: 5_000 }).catch(() => null),
      sshTransport
        .exec(['xcrun', 'simctl', 'list', 'devices', '-j'], { timeoutMs: 5_000 })
        .catch(() => null),
    ]);

    const android = adbRes?.ok
      ? parseAdbDevices(adbRes.stdout).map((d) => ({ ...d, udid: `ssh:${d.udid}` }))
      : [];
    let iosSim: IosDeviceInfo[] = [];
    if (simctlRes?.ok) {
      try {
        const json = JSON.parse(simctlRes.stdout) as SimctlDevicesJson;
        iosSim = parseSimctlDevices(json).map((d) => ({ ...d, udid: `ssh:${d.udid}` }));
      } catch {
        // ignore parse failures
      }
    }
    return { android, iosSim };
  }

  async function enumerate(force = false): Promise<{
    android: AndroidDeviceInfo[];
    iosSim: IosDeviceInfo[];
    iosReal: IosDeviceInfo[];
  }> {
    const now = Date.now();
    if (
      !force &&
      cachedAndroid &&
      cachedIosSim &&
      cachedIosReal &&
      now - lastEnumeratedAt < ENUMERATION_TTL_MS
    ) {
      return { android: cachedAndroid, iosSim: cachedIosSim, iosReal: cachedIosReal };
    }
    const [localAndroid, localIosSim, iosReal, ssh] = await Promise.all([
      listAndroidDevices(adbPath),
      listIosSimulators(xcrunPath),
      listIosPhysical(iosCliPath),
      sshEnumerate(),
    ]);

    // Track SSH-discovered UDIDs for get() to use SSH constructors.
    sshAndroidUdids.clear();
    for (const d of ssh.android) sshAndroidUdids.add(d.udid);
    sshIosSimUdids.clear();
    for (const d of ssh.iosSim) sshIosSimUdids.add(d.udid);

    cachedAndroid = [...localAndroid, ...ssh.android];
    cachedIosSim = [...localIosSim, ...ssh.iosSim];
    cachedIosReal = iosReal;
    lastEnumeratedAt = now;
    return { android: cachedAndroid, iosSim: cachedIosSim, iosReal: cachedIosReal };
  }

  return {
    async list(): Promise<CombinedDeviceInfo[]> {
      const { android, iosSim, iosReal } = await enumerate(true);
      const out: CombinedDeviceInfo[] = [];
      for (const a of android) {
        out.push({
          id: a.udid,
          platform: 'android',
          state: a.state,
          ...(a.model !== undefined ? { name: a.model } : {}),
          meta: {
            product: a.product,
            device: a.device,
            transportId: a.transportId,
            ...(sshAndroidUdids.has(a.udid) ? { ssh: 'true' } : {}),
          },
        });
      }
      for (const s of iosSim) {
        out.push({
          id: s.udid,
          platform: 'ios-sim',
          state: s.state,
          name: s.name,
          meta: {
            ...(s.runtime !== undefined ? { runtime: s.runtime } : {}),
            ...(sshIosSimUdids.has(s.udid) ? { ssh: 'true' } : {}),
          },
        });
      }
      for (const p of iosReal) {
        out.push({
          id: p.udid,
          platform: 'ios-real',
          state: p.state,
          name: p.name,
          ...(p.model !== undefined ? { meta: { model: p.model } } : {}),
        });
      }
      return out;
    },

    async get(deviceId: string): Promise<DeviceTransport> {
      const cached = cache.get(deviceId);
      if (cached) return cached;
      const { android, iosSim, iosReal } = await enumerate();

      if (android.some((d) => d.udid === deviceId)) {
        const dev =
          sshAndroidUdids.has(deviceId) && sshExecFn && sshTransport
            ? new AndroidDevice(deviceId, adbPath, sshExecFn, sshTransport)
            : new AndroidDevice(deviceId, adbPath);
        cache.set(deviceId, dev);
        return dev;
      }
      if (iosSim.some((d) => d.udid === deviceId)) {
        const dev =
          sshIosSimUdids.has(deviceId) && sshExecFn && sshTransport
            ? new IosSimDevice(deviceId, xcrunPath, sshExecFn, sshTransport)
            : new IosSimDevice(deviceId, xcrunPath);
        cache.set(deviceId, dev);
        return dev;
      }
      if (iosReal.some((d) => d.udid === deviceId)) {
        const dev = new IosPhysicalDevice(deviceId, iosCliPath);
        cache.set(deviceId, dev);
        return dev;
      }
      throw new Error(
        `Device '${deviceId}' not found. Call list_devices to see attached Android (adb) / iOS (simctl, go-ios) devices.`,
      );
    },

    async getAndroid(udid: string): Promise<AndroidDevice> {
      const dev = await this.get(udid);
      if (!(dev instanceof AndroidDevice)) {
        throw new Error(`Device '${udid}' is not an Android device.`);
      }
      return dev;
    },

    async getIosSim(udid: string): Promise<IosSimDevice> {
      const dev = await this.get(udid);
      if (!(dev instanceof IosSimDevice)) {
        throw new Error(`Device '${udid}' is not an iOS Simulator.`);
      }
      return dev;
    },

    async getIosPhysical(udid: string): Promise<IosPhysicalDevice> {
      const dev = await this.get(udid);
      if (!(dev instanceof IosPhysicalDevice)) {
        throw new Error(`Device '${udid}' is not a physical iOS device.`);
      }
      return dev;
    },

    invalidate(deviceId?: string): void {
      if (deviceId) {
        cache.delete(deviceId);
        return;
      }
      cache.clear();
      cachedAndroid = null;
      cachedIosSim = null;
      cachedIosReal = null;
      sshAndroidUdids.clear();
      sshIosSimUdids.clear();
      lastEnumeratedAt = 0;
    },

    async shutdown(): Promise<void> {
      await Promise.all(Array.from(cache.values()).map((d) => d.dispose().catch(() => undefined)));
      cache.clear();
      if (sshTransport) await sshTransport.dispose().catch(() => undefined);
    },
  };
}
