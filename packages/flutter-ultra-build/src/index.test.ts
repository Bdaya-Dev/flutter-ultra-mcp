import { describe, expect, it } from 'vitest';
import { createServer, SERVER_NAME, SERVER_VERSION } from './index.js';

describe('flutter-ultra-build server', () => {
  it('exposes a server name and version', () => {
    expect(SERVER_NAME).toBe('flutter-ultra-build');
    expect(SERVER_VERSION).toBe('0.0.0');
  });

  it('boots createServer without throwing', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it('registers all expected tool names', async () => {
    const server = createServer();
    // McpServer's internal `_registeredTools` is the only programmatic surface
    // for inspecting tool registrations in v1.x. We type-cast to read.
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const names = Object.keys(tools).sort();
    expect(names).toContain('analyze');
    expect(names).toContain('format');
    expect(names).toContain('pub_get');
    expect(names).toContain('pub_add');
    expect(names).toContain('start_build_runner_build');
    expect(names).toContain('poll_build_runner_job');
    expect(names).toContain('start_build_apk');
    expect(names).toContain('start_build_web');
    expect(names).toContain('start_build_windows');
    expect(names).toContain('verify_android_signing');
    expect(names).toContain('arb_diff');
    expect(names).toContain('add_asset');
    expect(names).toContain('validate_web_redirect');
    // Aim for the ~50-tool target per plan §5.1 (rev 10 expansion).
    expect(names.length).toBeGreaterThanOrEqual(50);
  });
});
