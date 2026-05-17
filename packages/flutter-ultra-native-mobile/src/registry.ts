// DeviceRegistry — per-process cache of resolved Device handles.
//
// Tools call registry.get(deviceId) instead of constructing AndroidDevice /
// IosSimDevice directly so a future SshDevice path can intercept the
// "physical device on remote host" case before falling through to local adb.

import { AndroidDevice, listAndroidDevices, type AndroidDeviceInfo } from './android.js';
import {
  IosPhysicalDevice,
  IosSimDevice,
  listIosPhysical,
  listIosSimulators,
  type IosDeviceInfo,
} from './ios.js';
import type { DeviceTransport } from './device.js';

export interface RegistryOptions {
  adbPath?: string;
  xcrunPath?: string;
  iosCliPath?: string;
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

  let cachedAndroid: AndroidDeviceInfo[] | null = null;
  let cachedIosSim: IosDeviceInfo[] | null = null;
  let cachedIosReal: IosDeviceInfo[] | null = null;
  let lastEnumeratedAt = 0;
  const ENUMERATION_TTL_MS = 5_000;

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
    const [android, iosSim, iosReal] = await Promise.all([
      listAndroidDevices(adbPath),
      listIosSimulators(xcrunPath),
      listIosPhysical(iosCliPath),
    ]);
    cachedAndroid = android;
    cachedIosSim = iosSim;
    cachedIosReal = iosReal;
    lastEnumeratedAt = now;
    return { android, iosSim, iosReal };
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
          meta: { product: a.product, device: a.device, transportId: a.transportId },
        });
      }
      for (const s of iosSim) {
        out.push({
          id: s.udid,
          platform: 'ios-sim',
          state: s.state,
          name: s.name,
          ...(s.runtime !== undefined ? { meta: { runtime: s.runtime } } : {}),
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
        const dev = new AndroidDevice(deviceId, adbPath);
        cache.set(deviceId, dev);
        return dev;
      }
      if (iosSim.some((d) => d.udid === deviceId)) {
        const dev = new IosSimDevice(deviceId, xcrunPath);
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
      lastEnumeratedAt = 0;
    },

    async shutdown(): Promise<void> {
      await Promise.all(Array.from(cache.values()).map((d) => d.dispose().catch(() => undefined)));
      cache.clear();
    },
  };
}
