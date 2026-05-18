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
    packageName: z.string().min(1),
    permission: z.string().min(1).describe('Full permission name, e.g. android.permission.CAMERA'),
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
