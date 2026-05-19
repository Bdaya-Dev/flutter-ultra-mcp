// Zod schemas (plan §16.2). Every object is `.strict()` to reject hallucinated keys.

import { z } from 'zod';

const browserType = z.enum(['chromium', 'firefox', 'webkit']);

const consoleLevel = z.enum([
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'verbose',
  'pageerror',
  'crash',
]);

export const launchBrowserSchema = z
  .object({
    type: browserType.default('chromium'),
    headless: z.boolean().default(true),
    persistProfileDir: z.string().optional(),
    args: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().max(300_000).optional(),
  })
  .strict();

export const connectOverCdpSchema = z
  .object({
    endpointURL: z
      .string()
      .describe(
        'CDP WebSocket or HTTP endpoint (e.g. http://127.0.0.1:58368). Typically the chromeCdpPort from discover_sessions.',
      ),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const closeBrowserSchema = z.object({ browserId: z.string() }).strict();

export const newContextSchema = z
  .object({
    browserId: z.string(),
    viewport: z
      .object({
        width: z.number().int().positive().max(8192),
        height: z.number().int().positive().max(8192),
      })
      .strict()
      .optional(),
  })
  .strict();

export const closeContextSchema = z.object({ contextId: z.string() }).strict();

export const newTabSchema = z
  .object({
    contextId: z.string(),
    url: z.string().url().optional(),
  })
  .strict();

export const navigateSchema = z
  .object({
    pageId: z.string(),
    url: z.string().url(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).default('load'),
    timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  })
  .strict();

export const interceptRedirectSchema = z
  .object({
    pageId: z.string(),
    urlPattern: z
      .string()
      .describe('Regex string (JavaScript regex syntax) matched against page URL on navigation.'),
    timeoutMs: z.number().int().positive().max(300_000).default(30_000),
  })
  .strict();

export const waitForUrlSchema = z
  .object({
    pageId: z.string(),
    urlPattern: z.string(),
    timeoutMs: z.number().int().positive().max(300_000).default(30_000),
  })
  .strict();

export const clickSchema = z
  .object({
    pageId: z.string(),
    selector: z.string(),
    button: z.enum(['left', 'right', 'middle']).default('left'),
    clickCount: z.number().int().min(1).max(3).default(1),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const fillSchema = z
  .object({
    pageId: z.string(),
    selector: z.string(),
    value: z.string(),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const pressKeySchema = z
  .object({
    pageId: z.string(),
    key: z.string().describe('Playwright key name, e.g. "Enter", "Control+A", "ArrowDown".'),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const screenshotSchema = z
  .object({
    pageId: z.string(),
    selector: z.string().optional(),
    fullPage: z.boolean().default(false),
    omitBackground: z.boolean().default(false),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const consoleLogsSchema = z
  .object({
    pageId: z.string(),
    limit: z.number().int().positive().max(2_000).default(200),
  })
  .strict();

export const startConsoleCaptureSchema = z
  .object({
    contextId: z.string(),
    levels: z.array(consoleLevel).optional(),
    textPattern: z.string().optional(),
    since: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe('ISO-8601 timestamp; events older than this are dropped.'),
  })
  .strict();

export const getConsoleCaptureSchema = z
  .object({
    captureId: z.string(),
    since: z.number().int().min(0).optional().describe('Cursor: index into buffer.'),
    limit: z.number().int().positive().max(5_000).default(500),
  })
  .strict();

export const stopConsoleCaptureSchema = z.object({ captureId: z.string() }).strict();

export const networkRequestsSchema = z
  .object({
    pageId: z.string(),
    limit: z.number().int().positive().max(5_000).default(500),
    kindFilter: z.array(z.enum(['request', 'response', 'requestfailed'])).optional(),
  })
  .strict();

export const evaluateJsSchema = z
  .object({
    pageId: z.string(),
    expression: z.string().describe('JavaScript expression evaluated in page context.'),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const setStorageSchema = z
  .object({
    contextId: z.string(),
    cookies: z
      .array(
        z
          .object({
            name: z.string(),
            value: z.string(),
            domain: z.string().optional(),
            path: z.string().optional(),
            expires: z.number().optional(),
            httpOnly: z.boolean().optional(),
            secure: z.boolean().optional(),
            sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
            url: z.string().url().optional(),
          })
          .strict(),
      )
      .optional(),
    localStorage: z
      .array(
        z
          .object({
            origin: z.string().url(),
            items: z.array(z.object({ name: z.string(), value: z.string() }).strict()),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const getStorageSchema = z.object({ contextId: z.string() }).strict();

export const linkToFlutterSchema = z
  .object({
    contextId: z.string(),
    flutterSessionId: z.string(),
  })
  .strict();

export const runPlaywrightScriptSchema = z
  .object({
    pageId: z.string(),
    script: z
      .string()
      .max(200_000)
      .describe(
        'JavaScript / TypeScript-style script run in a Node vm sandbox. Globals: page, context, browser, console, fetch, expect (if @playwright/test installed). No process/require/import.',
      ),
    wallTimeMs: z.number().int().positive().max(600_000).default(300_000),
    cpuKillMs: z.number().int().positive().max(120_000).default(30_000),
  })
  .strict();

export const evalPlaywrightRecipeSchema = z
  .object({
    pageId: z.string(),
    recipeName: z
      .string()
      .regex(/^[a-zA-Z0-9_\-.]+$/, 'recipeName must match [a-zA-Z0-9_-.]+ (no path traversal)'),
    params: z.record(z.string(), z.unknown()).optional(),
    wallTimeMs: z.number().int().positive().max(600_000).default(300_000),
  })
  .strict();

export const getWebPerfMetricsSchema = z
  .object({
    pageId: z.string(),
  })
  .strict();

export const takeHeapSnapshotSchema = z
  .object({
    pageId: z.string(),
    outputPath: z
      .string()
      .optional()
      .describe('Absolute path where the .heapsnapshot file is written. Defaults to a temp file.'),
  })
  .strict();
