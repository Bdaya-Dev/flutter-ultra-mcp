// Schema + registry unit tests. No browser required; safe for CI without
// Playwright browsers installed.

import { describe, it, expect } from 'vitest';
import { buildToolRegistry } from './index.js';
import * as schemas from './schemas.js';

describe('tool registry', () => {
  const registry = buildToolRegistry();

  it('registers all plan §5.4 tools', () => {
    const names = [
      'launch_browser',
      'close_browser',
      'new_context',
      'close_context',
      'new_tab',
      'navigate',
      'intercept_redirect',
      'wait_for_url',
      'click',
      'fill',
      'press_key',
      'screenshot',
      'console_logs',
      'start_console_capture',
      'get_console_capture',
      'stop_console_capture',
      'network_requests',
      'evaluate_js',
      'set_storage',
      'get_storage',
      'link_to_flutter',
      'run_playwright_script',
      'eval_playwright_recipe',
      'mock_network_route',
      'unmock_network_route',
      'list_mock_routes',
      'network_state_set',
      'drag',
      'drop_files',
      'handle_dialog',
      'start_tracing',
      'stop_tracing',
    ];
    for (const n of names) {
      expect(registry.has(n), `missing ${n}`).toBe(true);
    }
  });

  it('tool names stay within the 32-char MCP cap (§16.1)', () => {
    for (const name of registry.keys()) {
      expect(name.length, name).toBeLessThanOrEqual(32);
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('every tool has a watchdog ceiling (AC-T1)', () => {
    for (const t of registry.values()) {
      expect(t.meta.ceilingMs).toBeGreaterThan(0);
      expect(['instant', 'quick', 'long', 'marathon']).toContain(t.meta.class);
    }
  });
});

describe('schema strictness (§16.2)', () => {
  it('launch_browser rejects unknown keys', () => {
    const r = schemas.launchBrowserSchema.safeParse({ unknown: true });
    expect(r.success).toBe(false);
  });

  it('eval_playwright_recipe blocks path traversal in recipeName', () => {
    const bad = ['../../etc/passwd', '..\\win', '/etc/passwd', 'a/b'];
    for (const name of bad) {
      const r = schemas.evalPlaywrightRecipeSchema.safeParse({
        pageId: 'pg_x',
        recipeName: name,
      });
      expect(r.success, name).toBe(false);
    }
    const good = schemas.evalPlaywrightRecipeSchema.safeParse({
      pageId: 'pg_x',
      recipeName: 'login-flow_1.0',
    });
    expect(good.success).toBe(true);
  });

  it('console capture levels enum constrained', () => {
    const r = schemas.startConsoleCaptureSchema.safeParse({
      contextId: 'ctx_1',
      levels: ['log', 'pageerror'],
    });
    expect(r.success).toBe(true);
    const bad = schemas.startConsoleCaptureSchema.safeParse({
      contextId: 'ctx_1',
      levels: ['fatal'],
    });
    expect(bad.success).toBe(false);
  });

  it('mockNetworkRouteSchema: valid contextId+pattern+status+body, reject missing contextId', () => {
    const good = schemas.mockNetworkRouteSchema.safeParse({
      contextId: 'ctx_1',
      pattern: '**/api/v1/users**',
      status: 200,
      body: '{"ok":true}',
    });
    expect(good.success).toBe(true);
    const missing = schemas.mockNetworkRouteSchema.safeParse({
      pattern: '**/api/v1/users**',
      status: 200,
      body: '{"ok":true}',
    });
    expect(missing.success).toBe(false);
  });

  it('unmockNetworkRouteSchema: valid contextId+pattern, reject missing pattern', () => {
    const good = schemas.unmockNetworkRouteSchema.safeParse({
      contextId: 'ctx_1',
      pattern: '**/api/v1/users**',
    });
    expect(good.success).toBe(true);
    const missing = schemas.unmockNetworkRouteSchema.safeParse({
      contextId: 'ctx_1',
    });
    expect(missing.success).toBe(false);
  });

  it('networkStateSetSchema: valid boolean offline, reject non-boolean', () => {
    const good = schemas.networkStateSetSchema.safeParse({
      contextId: 'ctx_1',
      offline: true,
    });
    expect(good.success).toBe(true);
    const bad = schemas.networkStateSetSchema.safeParse({
      contextId: 'ctx_1',
      offline: 'yes',
    });
    expect(bad.success).toBe(false);
  });

  it('dragSchema: valid source+target selectors, reject missing source', () => {
    const good = schemas.dragSchema.safeParse({
      pageId: 'pg_1',
      source: '#drag-handle',
      target: '#drop-zone',
    });
    expect(good.success).toBe(true);
    const missing = schemas.dragSchema.safeParse({
      pageId: 'pg_1',
      target: '#drop-zone',
    });
    expect(missing.success).toBe(false);
  });

  it('dropFilesSchema: valid files array, reject empty files', () => {
    const good = schemas.dropFilesSchema.safeParse({
      pageId: 'pg_1',
      selector: '#file-input',
      files: ['/tmp/report.pdf'],
    });
    expect(good.success).toBe(true);
    const empty = schemas.dropFilesSchema.safeParse({
      pageId: 'pg_1',
      selector: '#file-input',
      files: [],
    });
    expect(empty.success).toBe(false);
  });

  it('handleDialogSchema: valid action enum (accept/dismiss), reject invalid action', () => {
    const accept = schemas.handleDialogSchema.safeParse({
      pageId: 'pg_1',
      action: 'accept',
    });
    expect(accept.success).toBe(true);
    const dismiss = schemas.handleDialogSchema.safeParse({
      pageId: 'pg_1',
      action: 'dismiss',
    });
    expect(dismiss.success).toBe(true);
    const bad = schemas.handleDialogSchema.safeParse({
      pageId: 'pg_1',
      action: 'ignore',
    });
    expect(bad.success).toBe(false);
  });

  it('startTracingSchema: valid contextId with defaults, reject missing contextId', () => {
    const good = schemas.startTracingSchema.safeParse({
      contextId: 'ctx_1',
    });
    expect(good.success).toBe(true);
    const missing = schemas.startTracingSchema.safeParse({
      screenshots: true,
    });
    expect(missing.success).toBe(false);
  });

  it('stopTracingSchema: valid contextId+outputPath, reject missing outputPath', () => {
    const good = schemas.stopTracingSchema.safeParse({
      contextId: 'ctx_1',
      outputPath: '/tmp/trace.zip',
    });
    expect(good.success).toBe(true);
    const missing = schemas.stopTracingSchema.safeParse({
      contextId: 'ctx_1',
    });
    expect(missing.success).toBe(false);
  });
});
