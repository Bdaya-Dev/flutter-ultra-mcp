import { describe, expect, it } from 'vitest';
import {
  setDeviceLocationSchema,
  clearDeviceLocationSchema,
  dispatchDeepLinkSchema,
  installAppSchema,
  uninstallAppSchema,
  clearAppDataSchema,
  listInstalledAppsSchema,
  toggleDeviceWifiSchema,
  toggleAirplaneModeSchema,
  shakeDeviceSchema,
  openNotificationTraySchema,
  listNotificationsSchema,
  tapNotificationSchema,
  dismissNotificationTraySchema,
  pickFileNativeSchema,
  addMediaToDeviceSchema,
  handleShareSheetSchema,
  detectInAppBrowserSchema,
  interactInAppBrowserSchema,
} from '../schemas.js';
import { parseDumpsysNotifications } from './notifications.js';

// ─── setDeviceLocationSchema ───────────────────────────────────────────────

describe('setDeviceLocationSchema', () => {
  it('accepts valid lat/lng', () => {
    const r = setDeviceLocationSchema.safeParse({
      deviceId: 'emulator-5554',
      latitude: 30.0,
      longitude: 31.5,
    });
    expect(r.success).toBe(true);
  });

  it('accepts boundary values (-90/90 lat, -180/180 lng)', () => {
    expect(
      setDeviceLocationSchema.safeParse({ deviceId: 'dev', latitude: -90, longitude: -180 })
        .success,
    ).toBe(true);
    expect(
      setDeviceLocationSchema.safeParse({ deviceId: 'dev', latitude: 90, longitude: 180 }).success,
    ).toBe(true);
  });

  it('accepts optional altitude', () => {
    const r = setDeviceLocationSchema.safeParse({
      deviceId: 'dev',
      latitude: 10,
      longitude: 20,
      altitude: 500,
    });
    expect(r.success).toBe(true);
  });

  it('rejects latitude < -90', () => {
    const r = setDeviceLocationSchema.safeParse({ deviceId: 'dev', latitude: -91, longitude: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects latitude > 90', () => {
    const r = setDeviceLocationSchema.safeParse({ deviceId: 'dev', latitude: 91, longitude: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects longitude > 180', () => {
    const r = setDeviceLocationSchema.safeParse({ deviceId: 'dev', latitude: 0, longitude: 181 });
    expect(r.success).toBe(false);
  });

  it('rejects longitude < -180', () => {
    const r = setDeviceLocationSchema.safeParse({ deviceId: 'dev', latitude: 0, longitude: -181 });
    expect(r.success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    const r = setDeviceLocationSchema.safeParse({ deviceId: '', latitude: 0, longitude: 0 });
    expect(r.success).toBe(false);
  });

  it('applies default timeoutMs', () => {
    const r = setDeviceLocationSchema.safeParse({ deviceId: 'dev', latitude: 0, longitude: 0 });
    expect(r.success && r.data.timeoutMs).toBe(15_000);
  });
});

// ─── clearDeviceLocationSchema ─────────────────────────────────────────────

describe('clearDeviceLocationSchema', () => {
  it('accepts valid deviceId', () => {
    const r = clearDeviceLocationSchema.safeParse({ deviceId: 'emulator-5554' });
    expect(r.success).toBe(true);
  });

  it('rejects empty deviceId', () => {
    const r = clearDeviceLocationSchema.safeParse({ deviceId: '' });
    expect(r.success).toBe(false);
  });

  it('applies default timeoutMs', () => {
    const r = clearDeviceLocationSchema.safeParse({ deviceId: 'dev' });
    expect(r.success && r.data.timeoutMs).toBe(15_000);
  });
});

// ─── dispatchDeepLinkSchema ────────────────────────────────────────────────

describe('dispatchDeepLinkSchema', () => {
  it('accepts valid uri + deviceId', () => {
    const r = dispatchDeepLinkSchema.safeParse({
      deviceId: 'emulator-5554',
      uri: 'myapp://path?query=1',
    });
    expect(r.success).toBe(true);
  });

  it('accepts optional packageName', () => {
    const r = dispatchDeepLinkSchema.safeParse({
      deviceId: 'dev',
      uri: 'myapp://path',
      packageName: 'com.example.app',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty uri', () => {
    const r = dispatchDeepLinkSchema.safeParse({ deviceId: 'dev', uri: '' });
    expect(r.success).toBe(false);
  });

  it('rejects missing uri', () => {
    const r = dispatchDeepLinkSchema.safeParse({ deviceId: 'dev' });
    expect(r.success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    const r = dispatchDeepLinkSchema.safeParse({ deviceId: '', uri: 'myapp://path' });
    expect(r.success).toBe(false);
  });
});

// ─── installAppSchema ──────────────────────────────────────────────────────

describe('installAppSchema', () => {
  it('accepts valid path + deviceId', () => {
    const r = installAppSchema.safeParse({
      deviceId: 'emulator-5554',
      apkOrIpaPath: '/tmp/app.apk',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty path', () => {
    const r = installAppSchema.safeParse({ deviceId: 'dev', apkOrIpaPath: '' });
    expect(r.success).toBe(false);
  });

  it('rejects missing path', () => {
    const r = installAppSchema.safeParse({ deviceId: 'dev' });
    expect(r.success).toBe(false);
  });

  it('applies default timeoutMs of 120s', () => {
    const r = installAppSchema.safeParse({ deviceId: 'dev', apkOrIpaPath: '/tmp/app.apk' });
    expect(r.success && r.data.timeoutMs).toBe(120_000);
  });
});

// ─── uninstallAppSchema ────────────────────────────────────────────────────

describe('uninstallAppSchema', () => {
  it('accepts valid packageId + deviceId', () => {
    const r = uninstallAppSchema.safeParse({
      deviceId: 'emulator-5554',
      packageName: 'com.example.app',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty packageName', () => {
    const r = uninstallAppSchema.safeParse({ deviceId: 'dev', packageName: '' });
    expect(r.success).toBe(false);
  });

  it('rejects missing packageName', () => {
    const r = uninstallAppSchema.safeParse({ deviceId: 'dev' });
    expect(r.success).toBe(false);
  });
});

// ─── clearAppDataSchema ────────────────────────────────────────────────────

describe('clearAppDataSchema', () => {
  it('accepts valid input', () => {
    const r = clearAppDataSchema.safeParse({ deviceId: 'dev', packageName: 'com.example.app' });
    expect(r.success).toBe(true);
  });

  it('rejects empty packageName', () => {
    const r = clearAppDataSchema.safeParse({ deviceId: 'dev', packageName: '' });
    expect(r.success).toBe(false);
  });
});

// ─── listInstalledAppsSchema ───────────────────────────────────────────────

describe('listInstalledAppsSchema', () => {
  it('accepts valid deviceId with defaults', () => {
    const r = listInstalledAppsSchema.safeParse({ deviceId: 'emulator-5554' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.includeSystem).toBe(false);
  });

  it('accepts includeSystem=true', () => {
    const r = listInstalledAppsSchema.safeParse({ deviceId: 'dev', includeSystem: true });
    expect(r.success).toBe(true);
  });

  it('rejects empty deviceId', () => {
    const r = listInstalledAppsSchema.safeParse({ deviceId: '' });
    expect(r.success).toBe(false);
  });
});

// ─── toggleDeviceWifiSchema ────────────────────────────────────────────────

describe('toggleDeviceWifiSchema', () => {
  it('accepts enable=true', () => {
    const r = toggleDeviceWifiSchema.safeParse({ deviceId: 'dev', enable: true });
    expect(r.success).toBe(true);
  });

  it('accepts enable=false', () => {
    const r = toggleDeviceWifiSchema.safeParse({ deviceId: 'dev', enable: false });
    expect(r.success).toBe(true);
  });

  it('rejects missing enable', () => {
    const r = toggleDeviceWifiSchema.safeParse({ deviceId: 'dev' });
    expect(r.success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    const r = toggleDeviceWifiSchema.safeParse({ deviceId: '', enable: true });
    expect(r.success).toBe(false);
  });
});

// ─── toggleAirplaneModeSchema ──────────────────────────────────────────────

describe('toggleAirplaneModeSchema', () => {
  it('accepts enable=true', () => {
    const r = toggleAirplaneModeSchema.safeParse({ deviceId: 'dev', enable: true });
    expect(r.success).toBe(true);
  });

  it('accepts enable=false', () => {
    const r = toggleAirplaneModeSchema.safeParse({ deviceId: 'dev', enable: false });
    expect(r.success).toBe(true);
  });

  it('rejects missing enable', () => {
    const r = toggleAirplaneModeSchema.safeParse({ deviceId: 'dev' });
    expect(r.success).toBe(false);
  });
});

// ─── shakeDeviceSchema ─────────────────────────────────────────────────────

describe('shakeDeviceSchema', () => {
  it('accepts valid deviceId', () => {
    const r = shakeDeviceSchema.safeParse({ deviceId: 'emulator-5554' });
    expect(r.success).toBe(true);
  });

  it('rejects empty deviceId', () => {
    const r = shakeDeviceSchema.safeParse({ deviceId: '' });
    expect(r.success).toBe(false);
  });

  it('applies default timeoutMs', () => {
    const r = shakeDeviceSchema.safeParse({ deviceId: 'dev' });
    expect(r.success && r.data.timeoutMs).toBe(15_000);
  });
});

// ─── openNotificationTraySchema ────────────────────────────────────────────

describe('openNotificationTraySchema', () => {
  it('accepts valid deviceId', () => {
    const r = openNotificationTraySchema.safeParse({ deviceId: 'dev' });
    expect(r.success).toBe(true);
  });

  it('rejects empty deviceId', () => {
    const r = openNotificationTraySchema.safeParse({ deviceId: '' });
    expect(r.success).toBe(false);
  });
});

// ─── listNotificationsSchema ───────────────────────────────────────────────

describe('listNotificationsSchema', () => {
  it('accepts valid deviceId', () => {
    const r = listNotificationsSchema.safeParse({ deviceId: 'dev' });
    expect(r.success).toBe(true);
  });

  it('rejects empty deviceId', () => {
    const r = listNotificationsSchema.safeParse({ deviceId: '' });
    expect(r.success).toBe(false);
  });
});

// ─── tapNotificationSchema ─────────────────────────────────────────────────

describe('tapNotificationSchema', () => {
  it('accepts finder kind=index', () => {
    const r = tapNotificationSchema.safeParse({
      deviceId: 'dev',
      finder: { kind: 'index', index: 0 },
    });
    expect(r.success).toBe(true);
  });

  it('accepts finder kind=package', () => {
    const r = tapNotificationSchema.safeParse({
      deviceId: 'dev',
      finder: { kind: 'package', packageName: 'com.example.app' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts finder kind=text', () => {
    const r = tapNotificationSchema.safeParse({
      deviceId: 'dev',
      finder: { kind: 'text', text: 'New message' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects finder kind=text with empty text', () => {
    const r = tapNotificationSchema.safeParse({
      deviceId: 'dev',
      finder: { kind: 'text', text: '' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects finder kind=package with empty packageName', () => {
    const r = tapNotificationSchema.safeParse({
      deviceId: 'dev',
      finder: { kind: 'package', packageName: '' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid finder kind', () => {
    const r = tapNotificationSchema.safeParse({
      deviceId: 'dev',
      finder: { kind: 'unknown' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    const r = tapNotificationSchema.safeParse({
      deviceId: '',
      finder: { kind: 'index', index: 0 },
    });
    expect(r.success).toBe(false);
  });
});

// ─── dismissNotificationTraySchema ─────────────────────────────────────────

describe('dismissNotificationTraySchema', () => {
  it('accepts valid deviceId', () => {
    const r = dismissNotificationTraySchema.safeParse({ deviceId: 'dev' });
    expect(r.success).toBe(true);
  });

  it('rejects empty deviceId', () => {
    const r = dismissNotificationTraySchema.safeParse({ deviceId: '' });
    expect(r.success).toBe(false);
  });
});

// ─── pickFileNativeSchema ──────────────────────────────────────────────────

describe('pickFileNativeSchema', () => {
  it('accepts valid path + targetType=photo', () => {
    const r = pickFileNativeSchema.safeParse({
      deviceId: 'dev',
      filePath: '/tmp/photo.jpg',
      targetType: 'photo',
    });
    expect(r.success).toBe(true);
  });

  it('accepts all targetType values', () => {
    for (const t of ['photo', 'video', 'audio', 'document'] as const) {
      const r = pickFileNativeSchema.safeParse({ deviceId: 'dev', filePath: '/f', targetType: t });
      expect(r.success).toBe(true);
    }
  });

  it('rejects invalid targetType', () => {
    const r = pickFileNativeSchema.safeParse({
      deviceId: 'dev',
      filePath: '/f',
      targetType: 'image',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty filePath', () => {
    const r = pickFileNativeSchema.safeParse({
      deviceId: 'dev',
      filePath: '',
      targetType: 'photo',
    });
    expect(r.success).toBe(false);
  });

  it('accepts optional wdaPort', () => {
    const r = pickFileNativeSchema.safeParse({
      deviceId: 'dev',
      filePath: '/f',
      targetType: 'photo',
      wdaPort: 8100,
    });
    expect(r.success).toBe(true);
  });
});

// ─── addMediaToDeviceSchema ────────────────────────────────────────────────

describe('addMediaToDeviceSchema', () => {
  it('accepts valid input', () => {
    const r = addMediaToDeviceSchema.safeParse({
      deviceId: 'dev',
      filePath: '/tmp/video.mp4',
      mediaType: 'video',
    });
    expect(r.success).toBe(true);
  });

  it('accepts all mediaType values', () => {
    for (const t of ['photo', 'video', 'audio', 'document'] as const) {
      const r = addMediaToDeviceSchema.safeParse({ deviceId: 'dev', filePath: '/f', mediaType: t });
      expect(r.success).toBe(true);
    }
  });

  it('rejects invalid mediaType', () => {
    const r = addMediaToDeviceSchema.safeParse({
      deviceId: 'dev',
      filePath: '/f',
      mediaType: 'gif',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty filePath', () => {
    const r = addMediaToDeviceSchema.safeParse({
      deviceId: 'dev',
      filePath: '',
      mediaType: 'photo',
    });
    expect(r.success).toBe(false);
  });
});

// ─── handleShareSheetSchema ────────────────────────────────────────────────

describe('handleShareSheetSchema', () => {
  it('accepts action=inspect', () => {
    const r = handleShareSheetSchema.safeParse({ deviceId: 'dev', action: 'inspect' });
    expect(r.success).toBe(true);
  });

  it('accepts action=dismiss', () => {
    const r = handleShareSheetSchema.safeParse({ deviceId: 'dev', action: 'dismiss' });
    expect(r.success).toBe(true);
  });

  it('accepts action=select with target', () => {
    const r = handleShareSheetSchema.safeParse({
      deviceId: 'dev',
      action: 'select',
      target: 'Gmail',
    });
    expect(r.success).toBe(true);
  });

  it('accepts action=select without target (schema allows optional)', () => {
    // Schema itself does not enforce target requirement — that is a runtime check.
    const r = handleShareSheetSchema.safeParse({ deviceId: 'dev', action: 'select' });
    expect(r.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const r = handleShareSheetSchema.safeParse({ deviceId: 'dev', action: 'share' });
    expect(r.success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    const r = handleShareSheetSchema.safeParse({ deviceId: '', action: 'inspect' });
    expect(r.success).toBe(false);
  });

  it('applies default wdaPort', () => {
    const r = handleShareSheetSchema.safeParse({ deviceId: 'dev', action: 'inspect' });
    expect(r.success && r.data.wdaPort).toBe(8100);
  });
});

// ─── detectInAppBrowserSchema ──────────────────────────────────────────────

describe('detectInAppBrowserSchema', () => {
  it('accepts valid deviceId', () => {
    const r = detectInAppBrowserSchema.safeParse({ deviceId: 'emulator-5554' });
    expect(r.success).toBe(true);
  });

  it('accepts custom wdaPort', () => {
    const r = detectInAppBrowserSchema.safeParse({ deviceId: 'dev', wdaPort: 9100 });
    expect(r.success).toBe(true);
  });

  it('rejects wdaPort 0', () => {
    const r = detectInAppBrowserSchema.safeParse({ deviceId: 'dev', wdaPort: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects wdaPort > 65535', () => {
    const r = detectInAppBrowserSchema.safeParse({ deviceId: 'dev', wdaPort: 65536 });
    expect(r.success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    const r = detectInAppBrowserSchema.safeParse({ deviceId: '' });
    expect(r.success).toBe(false);
  });
});

// ─── interactInAppBrowserSchema ────────────────────────────────────────────

describe('interactInAppBrowserSchema', () => {
  it('accepts action=read_url', () => {
    const r = interactInAppBrowserSchema.safeParse({ deviceId: 'dev', action: 'read_url' });
    expect(r.success).toBe(true);
  });

  it('accepts action=dismiss', () => {
    const r = interactInAppBrowserSchema.safeParse({ deviceId: 'dev', action: 'dismiss' });
    expect(r.success).toBe(true);
  });

  it('accepts action=tap with finder', () => {
    const r = interactInAppBrowserSchema.safeParse({
      deviceId: 'dev',
      action: 'tap',
      finder: 'Sign in',
    });
    expect(r.success).toBe(true);
  });

  it('accepts action=fill with finder and text', () => {
    const r = interactInAppBrowserSchema.safeParse({
      deviceId: 'dev',
      action: 'fill',
      finder: 'Email',
      text: 'user@example.com',
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const r = interactInAppBrowserSchema.safeParse({ deviceId: 'dev', action: 'scroll' });
    expect(r.success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    const r = interactInAppBrowserSchema.safeParse({ deviceId: '', action: 'read_url' });
    expect(r.success).toBe(false);
  });

  it('applies default wdaPort', () => {
    const r = interactInAppBrowserSchema.safeParse({ deviceId: 'dev', action: 'read_url' });
    expect(r.success && r.data.wdaPort).toBe(8100);
  });
});

// ─── parseDumpsysNotifications ─────────────────────────────────────────────

const DUMPSYS_OUTPUT = `
NotificationRecord(0xabc: pkg=com.example.app uid=10123 user=UserHandle{0} id=1 tag=null pri=0)
  uid=10123 userId=0
  key=0|com.example.app|1|null|10123
  postTime=1716492000000
  extras={
    android.title=String (8): My Title
    android.text=String (7): My Text
  }
NotificationRecord(0xdef: pkg=com.other.app uid=10200 user=UserHandle{0} id=2 tag=null pri=0)
  uid=10200 userId=0
  key=0|com.other.app|2|null|10200
  postTime=1716492001000
  extras={
    android.title=String (12): Another Title
    android.text=String (11): Another Text
  }
`;

describe('parseDumpsysNotifications', () => {
  it('returns empty array for empty input', () => {
    expect(parseDumpsysNotifications('')).toEqual([]);
  });

  it('returns empty array when no NotificationRecord blocks present', () => {
    expect(parseDumpsysNotifications('Notification Service\nsome other line\n')).toEqual([]);
  });

  it('parses package name from each record', () => {
    const out = parseDumpsysNotifications(DUMPSYS_OUTPUT);
    expect(out.map((n) => n.pkg)).toEqual(['com.example.app', 'com.other.app']);
  });

  it('parses notification key', () => {
    const out = parseDumpsysNotifications(DUMPSYS_OUTPUT);
    expect(out[0]?.key).toBe('0|com.example.app|1|null|10123');
  });

  it('parses postTime as a number', () => {
    const out = parseDumpsysNotifications(DUMPSYS_OUTPUT);
    expect(out[0]?.when).toBe(1716492000000);
  });

  it('parses android.title', () => {
    const out = parseDumpsysNotifications(DUMPSYS_OUTPUT);
    expect(out[0]?.title).toBe('My Title');
    expect(out[1]?.title).toBe('Another Title');
  });

  it('parses android.text', () => {
    const out = parseDumpsysNotifications(DUMPSYS_OUTPUT);
    expect(out[0]?.text).toBe('My Text');
    expect(out[1]?.text).toBe('Another Text');
  });

  it('handles missing title/text gracefully', () => {
    const minimal = `NotificationRecord(0x111: pkg=com.minimal uid=1 user=UserHandle{0} id=1 tag=null pri=0)\n  key=0|com.minimal|1|null|1\n  postTime=0\n`;
    const out = parseDumpsysNotifications(minimal);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('');
    expect(out[0]?.text).toBe('');
  });

  it('ignores malformed blocks without a pkg field', () => {
    const broken = `NotificationRecord(0x999: uid=10000 user=UserHandle{0})\n  key=0|missing|1|null|1\n`;
    const out = parseDumpsysNotifications(broken);
    expect(out).toHaveLength(0);
  });

  it('parses multiple notifications correctly', () => {
    const out = parseDumpsysNotifications(DUMPSYS_OUTPUT);
    expect(out).toHaveLength(2);
  });
});
