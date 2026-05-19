#!/usr/bin/env node
// flutter-ultra-browser MCP server entrypoint.
//
// Plan §5.4. Tool catalog: launch_browser, close_browser, new_context,
// close_context, new_tab, navigate, intercept_redirect, wait_for_url, click,
// fill, press_key, screenshot, console_logs, start_console_capture (rev-23),
// get_console_capture, stop_console_capture, network_requests, evaluate_js,
// set_storage, get_storage, link_to_flutter, run_playwright_script,
// eval_playwright_recipe.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

import { browserManager } from './browserManager.js';
import { log } from './logger.js';
import { withWatchdog, type ToolReturn, type ToolMeta, type ToolContext } from './watchdog.js';
import { fail } from './result.js';

import * as schemas from './schemas.js';
import * as lifecycle from './tools/lifecycle.js';
import * as navigation from './tools/navigation.js';
import * as interaction from './tools/interaction.js';
import * as screenshotTool from './tools/screenshot.js';
import * as consoleTool from './tools/console.js';
import * as networkTool from './tools/network.js';
import * as storageTool from './tools/storage.js';
import * as scripting from './tools/scripting.js';

export const SERVER_NAME = 'flutter-ultra-browser';

// Erased tool definition (schema typed as ZodTypeAny so the heterogeneous
// list typechecks; per-tool inference happens inside defTool below).
interface ToolDefErased {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  meta: Omit<ToolMeta, 'name'>;
  handler: (args: unknown, ctx?: Partial<ToolContext>) => Promise<ToolReturn>;
}

function defTool<S extends z.ZodTypeAny>(def: {
  name: string;
  description: string;
  schema: S;
  meta: Omit<ToolMeta, 'name'>;
  handler: (args: z.infer<S>, ctx?: Partial<ToolContext>) => Promise<ToolReturn>;
}): ToolDefErased {
  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    meta: def.meta,
    handler: def.handler as (a: unknown, c?: Partial<ToolContext>) => Promise<ToolReturn>,
  };
}

// Per-tool timeout ceilings from plan §17.3 `flutter-ultra-browser` table.
const TOOLS: ToolDefErased[] = [
  defTool({
    name: 'launch_browser',
    description:
      'Start a Playwright browser. Returns browserId. First call may download Chromium (~150MB).',
    schema: schemas.launchBrowserSchema,
    meta: { class: 'marathon', ceilingMs: 5 * 60_000 },
    handler: lifecycle.launchBrowser,
  }),
  defTool({
    name: 'connect_over_cdp',
    description:
      'Attach Playwright to an existing Chrome instance via CDP (Chrome DevTools Protocol). Use with the chromeCdpPort from discover_sessions to control the Flutter-launched Chrome — interact with non-Flutter pages (OIDC login, payment gateways) in the same browser session. Returns discovered contexts and pages.',
    schema: schemas.connectOverCdpSchema,
    meta: { class: 'marathon', ceilingMs: 60_000 },
    handler: lifecycle.connectOverCdp,
  }),
  defTool({
    name: 'close_browser',
    description: 'Close a browser instance and all its contexts/pages/captures.',
    schema: schemas.closeBrowserSchema,
    meta: { class: 'quick', ceilingMs: 15_000 },
    handler: lifecycle.closeBrowser,
  }),
  defTool({
    name: 'new_context',
    description: 'Create a fresh BrowserContext (isolated cookies/storage). Returns contextId.',
    schema: schemas.newContextSchema,
    meta: { class: 'quick', ceilingMs: 15_000 },
    handler: lifecycle.newContext,
  }),
  defTool({
    name: 'close_context',
    description: 'Close a context, all its pages, and any captures bound only to it.',
    schema: schemas.closeContextSchema,
    meta: { class: 'quick', ceilingMs: 15_000 },
    handler: lifecycle.closeContext,
  }),
  defTool({
    name: 'new_tab',
    description: 'Open a new page in a context, optionally navigating to a URL. Returns pageId.',
    schema: schemas.newTabSchema,
    meta: { class: 'quick', ceilingMs: 15_000 },
    handler: lifecycle.newTab,
  }),
  defTool({
    name: 'navigate',
    description: 'Navigate a page to a URL (page.goto).',
    schema: schemas.navigateSchema,
    meta: { class: 'long', ceilingMs: 60_000 },
    handler: navigation.navigate,
  }),
  defTool({
    name: 'intercept_redirect',
    description:
      'Wait for navigation matching a URL regex pattern; return matched URL with parsed query + fragment params. Useful for OAuth code extraction.',
    schema: schemas.interceptRedirectSchema,
    meta: { class: 'long', ceilingMs: 5 * 60_000 },
    handler: navigation.interceptRedirect,
  }),
  defTool({
    name: 'wait_for_url',
    description: 'Block until the page URL matches a regex pattern.',
    schema: schemas.waitForUrlSchema,
    meta: { class: 'long', ceilingMs: 5 * 60_000 },
    handler: navigation.waitForUrl,
  }),
  defTool({
    name: 'click',
    description: 'Click an element by selector.',
    schema: schemas.clickSchema,
    meta: { class: 'quick', ceilingMs: 30_000 },
    handler: interaction.click,
  }),
  defTool({
    name: 'fill',
    description: 'Fill an input field by selector.',
    schema: schemas.fillSchema,
    meta: { class: 'quick', ceilingMs: 30_000 },
    handler: interaction.fill,
  }),
  defTool({
    name: 'press_key',
    description: 'Press a keyboard key (Playwright key name, e.g. "Enter", "Control+A").',
    schema: schemas.pressKeySchema,
    meta: { class: 'quick', ceilingMs: 30_000 },
    handler: interaction.pressKey,
  }),
  defTool({
    name: 'screenshot',
    description:
      'Capture a screenshot (full page or by selector). Works on CanvasKit Flutter web (AC-Br2).',
    schema: schemas.screenshotSchema,
    meta: { class: 'quick', ceilingMs: 30_000 },
    handler: screenshotTool.screenshot,
  }),
  defTool({
    name: 'console_logs',
    description:
      'One-shot read of recent page console events. For continuous capture see start_console_capture.',
    schema: schemas.consoleLogsSchema,
    meta: { class: 'quick', ceilingMs: 30_000 },
    handler: consoleTool.consoleLogs,
  }),
  defTool({
    name: 'start_console_capture',
    description:
      'Start a persistent console+pageerror+crash capture over a context (rev-23). Survives navigation and new-page spawns. Returns captureId.',
    schema: schemas.startConsoleCaptureSchema,
    meta: { class: 'quick', ceilingMs: 15_000 },
    handler: consoleTool.startConsoleCapture,
  }),
  defTool({
    name: 'get_console_capture',
    description: 'Cursor-paginated read from a console capture. Safe to call repeatedly.',
    schema: schemas.getConsoleCaptureSchema,
    meta: { class: 'quick', ceilingMs: 15_000 },
    handler: consoleTool.getConsoleCapture,
  }),
  defTool({
    name: 'stop_console_capture',
    description: 'Stop a console capture and return its remaining events.',
    schema: schemas.stopConsoleCaptureSchema,
    meta: { class: 'quick', ceilingMs: 15_000 },
    handler: consoleTool.stopConsoleCapture,
  }),
  defTool({
    name: 'network_requests',
    description: 'Recent network events (request/response/requestfailed) for a page.',
    schema: schemas.networkRequestsSchema,
    meta: { class: 'quick', ceilingMs: 30_000 },
    handler: networkTool.networkRequests,
  }),
  defTool({
    name: 'evaluate_js',
    description: 'Evaluate a JS expression in the page context. Result is JSON-serialized.',
    schema: schemas.evaluateJsSchema,
    meta: { class: 'quick', ceilingMs: 30_000 },
    handler: scripting.evaluateJs,
  }),
  defTool({
    name: 'set_storage',
    description:
      'Pre-seed cookies and/or localStorage on a context. localStorage is applied via addInitScript so it is present from first navigation.',
    schema: schemas.setStorageSchema,
    meta: { class: 'quick', ceilingMs: 15_000 },
    handler: storageTool.setStorage,
  }),
  defTool({
    name: 'get_storage',
    description: 'Export cookies + localStorage for a context (storageState).',
    schema: schemas.getStorageSchema,
    meta: { class: 'quick', ceilingMs: 15_000 },
    handler: storageTool.getStorage,
  }),
  defTool({
    name: 'link_to_flutter',
    description:
      'Associate this browser context with a Flutter sessionId. Visible to other servers via state/browsers.json.',
    schema: schemas.linkToFlutterSchema,
    meta: { class: 'quick', ceilingMs: 5_000 },
    handler: storageTool.linkToFlutter,
  }),
  defTool({
    name: 'run_playwright_script',
    description:
      'Run a sandboxed Playwright TS/JS script against a page. Globals: page, context, browser, console, fetch, expect (if installed). No process/require/import. Wall-time + CPU watchdog enforced.',
    schema: schemas.runPlaywrightScriptSchema,
    meta: { class: 'long', ceilingMs: 5 * 60_000 },
    handler: scripting.runPlaywrightScriptTool,
  }),
  defTool({
    name: 'eval_playwright_recipe',
    description:
      'Run a named recipe from ${CLAUDE_PLUGIN_DATA}/recipes/<name>.ts (or .js/.mjs). Name restricted to [a-zA-Z0-9_-.]. Params passed as `params` const in script scope.',
    schema: schemas.evalPlaywrightRecipeSchema,
    meta: { class: 'long', ceilingMs: 5 * 60_000 },
    handler: scripting.evalPlaywrightRecipe,
  }),
];

export function buildToolRegistry(): Map<string, ToolDefErased> {
  const map = new Map<string, ToolDefErased>();
  for (const t of TOOLS) {
    if (map.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`);
    if (t.name.length > 32) throw new Error(`Tool name '${t.name}' > 32 chars`);
    map.set(t.name, t);
  }
  return map;
}

async function main(): Promise<void> {
  const registry = buildToolRegistry();
  log.info('starting', { tools: registry.size });

  const server = new Server(
    { name: SERVER_NAME, version: '0.0.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(registry.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }) as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const tool = registry.get(req.params.name);
    if (!tool) {
      return fail(
        `Unknown tool: ${req.params.name}`,
        `Known tools: ${Array.from(registry.keys()).join(', ')}.`,
      ) as never;
    }
    const parsed = tool.schema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      return fail(
        `Invalid arguments for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        'Re-call with arguments matching the tool inputSchema.',
      ) as never;
    }

    const wrapped = withWatchdog({ name: tool.name, ...tool.meta }, tool.handler);
    const ctx: Partial<ToolContext> = {
      signal: extra.signal,
      sendProgress: (p) => {
        const token = (req.params._meta as { progressToken?: string | number } | undefined)
          ?.progressToken;
        if (token === undefined) return;
        void server.notification({
          method: 'notifications/progress',
          params: { progressToken: token, ...p },
        });
      },
    };
    const result = await wrapped(parsed.data, ctx);
    // ToolReturn matches MCP CallToolResult; cast to satisfy the SDK's
    // discriminated union (which includes a separate `task`-bearing variant).
    return result as never;
  });

  const transport = new StdioServerTransport();

  let shutdown = false;
  const cleanup = async (sig: string) => {
    if (shutdown) return;
    shutdown = true;
    log.info('shutdown', { signal: sig });
    try {
      await browserManager.shutdownAll();
    } catch (err) {
      log.warn('shutdown_failure', { err: (err as Error).message });
    }
    try {
      await server.close();
    } catch {
      // already closed
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void cleanup('SIGTERM'));
  process.on('SIGINT', () => void cleanup('SIGINT'));

  await server.connect(transport);
  log.info('ready');
}

// Allow this file to be imported by tests without auto-starting the server.
// In an ESM Node 22 entrypoint, import.meta.url === pathToFileURL(process.argv[1]).
const isEntrypoint =
  process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;

if (isEntrypoint) {
  main().catch((err) => {
    log.error('fatal', { err: (err as Error).message, stack: (err as Error).stack });
    process.exit(1);
  });
}
