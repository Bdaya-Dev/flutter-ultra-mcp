// Zod schemas (plan §16.2). Every object is `.strict()` so the LLM can't
// pass hallucinated keys past validation.

import { z } from 'zod';

export const deviceIdSchema = z
  .string()
  .min(1)
  .describe('Device UDID. For Android, the adb serial; for iOS, the simctl/UDID string.');

export const finderSpecSchema = z
  .object({
    text: z.string().optional(),
    textContains: z.string().optional(),
    resourceId: z.string().optional(),
    contentDesc: z.string().optional(),
    className: z.string().optional(),
    index: z.number().int().min(0).default(0),
  })
  .strict()
  .refine(
    (v) =>
      v.text !== undefined ||
      v.textContains !== undefined ||
      v.resourceId !== undefined ||
      v.contentDesc !== undefined ||
      v.className !== undefined,
    {
      message:
        'finder must specify at least one of text/textContains/resourceId/contentDesc/className',
    },
  );

export const listDevicesSchema = z
  .object({
    includeOffline: z.boolean().default(false),
  })
  .strict();

export const dumpA11ySchema = z
  .object({
    deviceId: deviceIdSchema,
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
    wdaPort: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(8100)
      .describe(
        'iOS Simulator only: port where WebDriverAgent is listening (default 8100). Ignored for Android.',
      ),
    compact: z
      .boolean()
      .default(true)
      .describe(
        'Strip non-essential fields and flatten empty wrapper nodes to reduce token usage for AI agents.',
      ),
  })
  .strict();

export const tapTargetSchema = z.union([
  z.object({ kind: z.literal('coords'), x: z.number().int(), y: z.number().int() }).strict(),
  z.object({ kind: z.literal('finder'), finder: finderSpecSchema }).strict(),
]);

export const nativeTapSchema = z
  .object({
    deviceId: deviceIdSchema,
    target: tapTargetSchema,
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const nativeTypeSchema = z
  .object({
    deviceId: deviceIdSchema,
    text: z.string(),
    // Some adb versions choke on spaces; we URL-escape internally. Caller
    // doesn't need to know.
    clearFirst: z.boolean().default(false),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const nativeSwipeSchema = z
  .object({
    deviceId: deviceIdSchema,
    fromX: z.number().int(),
    fromY: z.number().int(),
    toX: z.number().int(),
    toY: z.number().int(),
    durationMs: z.number().int().min(50).max(10_000).default(300),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const nativeBackSchema = z
  .object({
    deviceId: deviceIdSchema,
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const nativeHomeSchema = nativeBackSchema;
export const nativeAppSwitchSchema = nativeBackSchema;
export const nativeOpenSettingsSchema = nativeBackSchema;

export const nativePinLockSchema = z
  .object({
    deviceId: deviceIdSchema,
    enable: z.boolean(),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const waitForNativeElementSchema = z
  .object({
    deviceId: deviceIdSchema,
    finder: finderSpecSchema,
    timeoutMs: z.number().int().positive().max(300_000).default(30_000),
    pollIntervalMs: z.number().int().min(100).max(5_000).default(500),
    wdaPort: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(8100)
      .describe('iOS Simulator only: WebDriverAgent port (default 8100). Ignored for Android.'),
  })
  .strict();

export const dismissPermissionDialogSchema = z
  .object({
    deviceId: deviceIdSchema,
    intent: z.enum(['allow', 'deny']).default('allow'),
    timeoutMs: z.number().int().positive().max(30_000).default(10_000),
  })
  .strict();

export const nativePermissionGrantSchema = z
  .object({
    deviceId: deviceIdSchema,
    packageName: z
      .string()
      .min(1)
      .describe(
        'Android: package name (e.g. com.example.app). iOS: bundle ID (e.g. com.example.App).',
      ),
    permission: z
      .string()
      .min(1)
      .describe(
        'Android: full permission name, e.g. android.permission.CAMERA. iOS: simctl privacy service name, e.g. camera, microphone, photos, location, contacts, calendar, reminders, all.',
      ),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const nativePermissionDenySchema = nativePermissionGrantSchema;

export const takeDeviceScreenshotSchema = z
  .object({
    deviceId: deviceIdSchema,
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const setDeviceOrientationSchema = z
  .object({
    deviceId: deviceIdSchema,
    orientation: z.enum(['portrait', 'landscape']),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const clipboardSetSchema = z
  .object({
    deviceId: deviceIdSchema,
    text: z.string(),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const clipboardGetSchema = z
  .object({
    deviceId: deviceIdSchema,
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

// Device-logs split-tool trio.
export const startDeviceLogsSchema = z
  .object({
    deviceId: deviceIdSchema,
    // Android logcat tag filters: e.g. ['ActivityManager:I', '*:S'].
    tagFilters: z.array(z.string()).optional(),
    // Regex applied after tag filter.
    grep: z.string().optional(),
    bufferLines: z.number().int().min(50).max(50_000).default(1_000),
  })
  .strict();

export const pollDeviceLogsSchema = z
  .object({
    streamId: z.string().min(1),
    afterCursor: z.number().int().min(0).default(0),
    maxLines: z.number().int().min(1).max(5_000).default(500),
  })
  .strict();

export const stopDeviceLogsSchema = z.object({ streamId: z.string().min(1) }).strict();

// Device screen recording split-tool pair.
export const startDeviceRecordingSchema = z
  .object({
    deviceId: deviceIdSchema,
    outputPath: z
      .string()
      .min(1)
      .describe('Absolute local path where the recording will be saved (e.g. /tmp/demo.mp4).'),
    maxDurationSec: z
      .number()
      .int()
      .min(1)
      .max(180)
      .default(30)
      .describe('Maximum recording duration in seconds (Android screenrecord limit: 180).'),
    timeoutMs: z.number().int().positive().max(300_000).default(60_000),
  })
  .strict();

export const stopDeviceRecordingSchema = z
  .object({
    recordingId: z.string().min(1).describe('ID returned by start_device_recording.'),
  })
  .strict();

// GPS / location simulation.
export const setDeviceLocationSchema = z
  .object({
    deviceId: deviceIdSchema,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    altitude: z.number().optional().describe('Altitude in metres (Android emulator only).'),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const clearDeviceLocationSchema = z
  .object({
    deviceId: deviceIdSchema,
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

// Deep link dispatch.
export const dispatchDeepLinkSchema = z
  .object({
    deviceId: deviceIdSchema,
    uri: z.string().min(1).describe('The URI to dispatch, e.g. "myapp://path?query=1".'),
    packageName: z
      .string()
      .optional()
      .describe('Android only: restrict the intent to this package name.'),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

// App install / uninstall / clear / list.
export const installAppSchema = z
  .object({
    deviceId: deviceIdSchema,
    apkOrIpaPath: z
      .string()
      .min(1)
      .describe('Absolute local path to the .apk (Android) or .app bundle dir (iOS sim).'),
    timeoutMs: z.number().int().positive().max(300_000).default(120_000),
  })
  .strict();

export const uninstallAppSchema = z
  .object({
    deviceId: deviceIdSchema,
    packageName: z
      .string()
      .min(1)
      .describe(
        'Package name (Android, e.g. com.example.app) or bundle ID (iOS, e.g. com.example.App).',
      ),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const clearAppDataSchema = z
  .object({
    deviceId: deviceIdSchema,
    packageName: z.string().min(1).describe('Android package name whose data will be cleared.'),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const listInstalledAppsSchema = z
  .object({
    deviceId: deviceIdSchema,
    includeSystem: z.boolean().default(false).describe('Include system packages (Android only).'),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

// Network / WiFi toggle and device shake.
export const toggleDeviceWifiSchema = z
  .object({
    deviceId: deviceIdSchema,
    enable: z.boolean(),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const toggleAirplaneModeSchema = z
  .object({
    deviceId: deviceIdSchema,
    enable: z.boolean(),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const shakeDeviceSchema = z
  .object({
    deviceId: deviceIdSchema,
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

// Notification tray tools.
export const openNotificationTraySchema = z
  .object({
    deviceId: deviceIdSchema,
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const listNotificationsSchema = z
  .object({
    deviceId: deviceIdSchema,
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const tapNotificationFinderSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('index'),
      index: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('Zero-based index of the notification row in the a11y tree.'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('package'),
      packageName: z
        .string()
        .min(1)
        .describe('Android package name of the notifying app (e.g. com.example.app).'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('text'),
      text: z
        .string()
        .min(1)
        .describe('Substring of the notification title or content description to match.'),
    })
    .strict(),
]);

export const tapNotificationSchema = z
  .object({
    deviceId: deviceIdSchema,
    finder: tapNotificationFinderSchema,
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const dismissNotificationTraySchema = z
  .object({
    deviceId: deviceIdSchema,
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

// Share sheet interaction.
export const handleShareSheetSchema = z
  .object({
    deviceId: deviceIdSchema,
    action: z
      .enum(['inspect', 'select', 'dismiss'])
      .describe(
        'inspect: list available share targets without tapping. select: tap the named target. dismiss: close the share sheet.',
      ),
    target: z
      .string()
      .optional()
      .describe('Share target label to tap (required when action=select).'),
    wdaPort: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(8100)
      .describe('iOS Simulator only: WebDriverAgent port (default 8100). Ignored for Android.'),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

// In-app browser (CCT / SVC) detection and interaction.
export const detectInAppBrowserSchema = z
  .object({
    deviceId: deviceIdSchema,
    wdaPort: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(8100)
      .describe('iOS Simulator only: WebDriverAgent port (default 8100). Ignored for Android.'),
    timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  })
  .strict();

export const interactInAppBrowserSchema = z
  .object({
    deviceId: deviceIdSchema,
    action: z
      .enum(['tap', 'fill', 'read_url', 'dismiss'])
      .describe(
        'tap: tap a web content element by text. fill: type into a focused field. read_url: read the current address bar URL. dismiss: close the in-app browser.',
      ),
    finder: z
      .string()
      .optional()
      .describe('Text to match against web content a11y nodes (required for tap/fill).'),
    text: z.string().optional().describe('Text to enter (required for fill).'),
    wdaPort: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(8100)
      .describe('iOS Simulator only: WebDriverAgent port (default 8100). Ignored for Android.'),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

// File picker / media staging.
export const pickFileNativeSchema = z
  .object({
    deviceId: deviceIdSchema,
    filePath: z
      .string()
      .min(1)
      .describe('Absolute local path of the file to stage and select on the device.'),
    targetType: z
      .enum(['photo', 'video', 'audio', 'document'])
      .describe(
        'Media category — controls the Android scoped-storage directory (DCIM for photo/video, Music for audio, Download for document). iOS always uses Photos library.',
      ),
    wdaPort: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe(
        'iOS Simulator only: WebDriverAgent port for PHPicker a11y navigation (omit to stage only).',
      ),
    timeoutMs: z.number().int().positive().max(120_000).default(60_000),
  })
  .strict();

export const addMediaToDeviceSchema = z
  .object({
    deviceId: deviceIdSchema,
    filePath: z.string().min(1).describe('Absolute local path of the file to stage on the device.'),
    mediaType: z
      .enum(['photo', 'video', 'audio', 'document'])
      .describe(
        'Media category — controls Android destination directory. iOS always imports into Photos library regardless of type.',
      ),
    timeoutMs: z.number().int().positive().max(120_000).default(60_000),
  })
  .strict();

// CCT OAuth composite tool (plan §5.5.1).
export const solveOauthSchema = z
  .object({
    deviceId: deviceIdSchema.describe(
      'The Android/iOS device that will receive the deep-link dispatch.',
    ),
    sessionId: z
      .string()
      .optional()
      .describe('Optional flutter-ultra-runtime sessionId for state correlation.'),
    authorizeUrl: z
      .string()
      .url()
      .describe('The OAuth provider authorize URL the app would have opened in CCT/SVC.'),
    redirectUriScheme: z
      .string()
      .min(1)
      .describe('App scheme prefix, e.g. "com.example.myapp" or "app.mycompany.dev".'),
    redirectUriPattern: z
      .string()
      .min(1)
      .describe('Regex matched against the redirect URL (Playwright waitForURL).'),
    androidPackage: z
      .string()
      .optional()
      .describe(
        'Optional Android package; if set, the deep-link intent is restricted to this package.',
      ),
    fillFlow: z
      .object({
        usernameSelector: z.string(),
        username: z.string(),
        passwordSelector: z.string(),
        password: z.string(),
        submitSelector: z.string(),
      })
      .strict()
      .optional(),
    persistProfileDir: z
      .string()
      .optional()
      .describe('Playwright persistent context dir for cookie reuse.'),
    timeoutMs: z.number().int().positive().max(300_000).default(60_000),
    headless: z.boolean().default(true),
  })
  .strict();
