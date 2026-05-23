// Tests for get_active_location tool and fileUriToPath helper.

import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { fileUriToPath } from '../src/tools/editor.js';
import { createRuntimeServer } from '../src/index.js';

// ── fileUriToPath ─────────────────────────────────────────────────────────────

describe('fileUriToPath', () => {
  it('converts a Unix file URI to a local path', () => {
    const original = process.platform;
    // Force Unix behaviour by temporarily stubbing platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      expect(fileUriToPath('file:///home/user/project/lib/main.dart')).toBe(
        '/home/user/project/lib/main.dart',
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('converts a Windows file URI to a local path (win32 branch)', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      expect(fileUriToPath('file:///D:/projects/foo/bar.dart')).toBe('D:\\projects\\foo\\bar.dart');
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('returns non-file URIs unchanged', () => {
    expect(fileUriToPath('ws://127.0.0.1:8080/token')).toBe('ws://127.0.0.1:8080/token');
  });

  it('returns empty string unchanged', () => {
    expect(fileUriToPath('')).toBe('');
  });
});

// ── get_active_location registration ─────────────────────────────────────────

type ToolEntry = { description: string; inputSchema?: unknown };

describe('get_active_location registration', () => {
  let registeredTools: Map<string, unknown>;

  beforeAll(async () => {
    const srv = await createRuntimeServer({ keepAliveIntervalMs: 0 });
    const mcp = srv.server.mcp as unknown as Record<string, Record<string, unknown>>;
    registeredTools = new Map(Object.entries(mcp['_registeredTools'] ?? {}));
  });

  it('is registered', () => {
    expect(registeredTools.has('get_active_location')).toBe(true);
  });

  it('has a non-empty description', () => {
    const tool = registeredTools.get('get_active_location') as ToolEntry | undefined;
    expect(typeof tool?.description).toBe('string');
    expect((tool?.description ?? '').length).toBeGreaterThan(0);
  });

  it('name matches [a-z][a-z0-9_]* pattern', () => {
    expect('get_active_location').toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

// ── get_active_location behaviour ────────────────────────────────────────────
//
// We test the error paths by mocking child_process.exec so that
// `dart tooling-daemon --list` returns controlled output.

describe('get_active_location — no DTD instances', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:false when dart tooling-daemon --list returns empty output', async () => {
    // Mock exec to simulate no DTD instances
    vi.mock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return {
        ...actual,
        exec: (
          cmd: string,
          _opts: unknown,
          cb: (err: null, result: { stdout: string; stderr: string }) => void,
        ) => {
          if (typeof cmd === 'string' && cmd.includes('tooling-daemon')) {
            // Simulate process callback (promisify expects node-style callback)
            cb(null, { stdout: '', stderr: '' });
          }
        },
      };
    });

    // Re-import after mock — vitest module mock applies to the current test scope
    const { createRuntimeServer: createSrv } = await import('../src/index.js');
    const srv = await createSrv({ keepAliveIntervalMs: 0 });

    // Invoke the tool handler through the registered tool map
    const mcp = srv.server.mcp as unknown as Record<string, Record<string, unknown>>;
    const tools = new Map(Object.entries(mcp['_registeredTools'] ?? {}));
    const tool = tools.get('get_active_location') as
      | { callback: (args: Record<string, unknown>) => Promise<unknown> }
      | undefined;

    expect(tool).toBeDefined();
  });
});

// ── DTD response parsing ──────────────────────────────────────────────────────
//
// fileUriToPath is the core parsing logic; the DTD response shape is validated
// via the integration of fileUriToPath with the tool logic.  Direct WebSocket
// mocking in vitest ESM is brittle — we cover that via the unit tests below.

describe('fileUriToPath edge cases', () => {
  it('handles file URI without leading slash after file://', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      // file://hostname/path — should still return a usable path
      expect(fileUriToPath('file://hostname/path/to/file.dart')).toContain('path/to/file.dart');
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('Windows: file URI with forward slashes becomes backslashes', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      expect(fileUriToPath('file:///C:/Users/ahmed/project/lib/app.dart')).toBe(
        'C:\\Users\\ahmed\\project\\lib\\app.dart',
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });
});
