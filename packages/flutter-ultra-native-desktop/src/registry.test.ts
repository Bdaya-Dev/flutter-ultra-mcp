import { describe, it, expect } from 'vitest';
import { createServer } from '@flutter-ultra/mcp-runtime';
import { registerDesktopTools } from './registry.js';
import type {
  A11yNode,
  BackendCapabilities,
  ConfirmDialogOptions,
  DesktopBackend,
  DesktopClickOptions,
  DesktopQueryOptions,
  DesktopScreenshotOptions,
  DesktopTypeOptions,
  DumpWindowTreeOptions,
  ListWindowsOptions,
  SelectFileInDialogOptions,
  WaitForWindowOptions,
  WindowDescriptor,
} from './types.js';

function fakeWindow(over: Partial<WindowDescriptor> = {}): WindowDescriptor {
  return {
    id: 'win-1',
    title: 'Test Window',
    processName: 'TestApp',
    pid: 4242,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    isMain: true,
    isMinimized: false,
    ...over,
  };
}

function fakeNode(over: Partial<A11yNode> = {}): A11yNode {
  return {
    id: 'el-1',
    role: 'AXButton',
    title: 'OK',
    label: null,
    value: null,
    enabled: true,
    focused: false,
    bounds: { x: 10, y: 10, width: 40, height: 20 },
    children: [],
    ...over,
  };
}

class StubBackend implements DesktopBackend {
  capabilities: BackendCapabilities = {
    platform: 'darwin',
    helperPresent: true,
    permissionGranted: true,
    waylandLimited: false,
    remediation: null,
  };
  calls: Array<{ method: string; args: unknown }> = [];

  async listWindows(opts: ListWindowsOptions): Promise<WindowDescriptor[]> {
    this.calls.push({ method: 'listWindows', args: opts });
    return [fakeWindow()];
  }
  async dumpWindowTree(opts: DumpWindowTreeOptions): Promise<A11yNode> {
    this.calls.push({ method: 'dumpWindowTree', args: opts });
    return fakeNode();
  }
  async desktopQuery(opts: DesktopQueryOptions): Promise<A11yNode[]> {
    this.calls.push({ method: 'desktopQuery', args: opts });
    return [fakeNode({ title: 'OK' })];
  }
  async desktopClick(opts: DesktopClickOptions): Promise<{ clicked: true }> {
    this.calls.push({ method: 'desktopClick', args: opts });
    return { clicked: true };
  }
  async desktopType(opts: DesktopTypeOptions): Promise<{ typed: true }> {
    this.calls.push({ method: 'desktopType', args: opts });
    return { typed: true };
  }
  async desktopScreenshot(opts: DesktopScreenshotOptions): Promise<{ pngBase64: string }> {
    this.calls.push({ method: 'desktopScreenshot', args: opts });
    return { pngBase64: 'iVBORw0KGgo=' };
  }
  async selectFileInDialog(opts: SelectFileInDialogOptions): Promise<{ confirmed: true }> {
    this.calls.push({ method: 'selectFileInDialog', args: opts });
    return { confirmed: true };
  }
  async confirmDialog(
    opts: ConfirmDialogOptions,
  ): Promise<{ confirmed: true; matchedButton: string }> {
    this.calls.push({ method: 'confirmDialog', args: opts });
    return { confirmed: true, matchedButton: 'OK' };
  }
  async waitForWindow(opts: WaitForWindowOptions): Promise<WindowDescriptor> {
    this.calls.push({ method: 'waitForWindow', args: opts });
    return fakeWindow({ title: opts.titlePattern ?? 'Wait Result' });
  }
  async shutdown(): Promise<void> {
    /* noop */
  }
}

describe('registerDesktopTools', () => {
  it('registers ZERO tools when backend is null (AC-ND4)', () => {
    const server = createServer({
      info: { name: 'native-desktop-test', version: '0.0.0' },
    });
    const count = registerDesktopTools({ server, backend: null });
    expect(count).toBe(0);
  });

  it('registers all 9 tools when backend is healthy', () => {
    const server = createServer({
      info: { name: 'native-desktop-test', version: '0.0.0' },
    });
    const backend = new StubBackend();
    const count = registerDesktopTools({ server, backend });
    expect(count).toBe(9);
  });

  it('respects toolPrefix for namespaced registrations', () => {
    const server = createServer({
      info: { name: 'native-desktop-test', version: '0.0.0' },
    });
    const backend = new StubBackend();
    // We can't easily introspect the McpServer's tool list, but at least
    // assert no throw and same count.
    const count = registerDesktopTools({ server, backend, toolPrefix: 'mac_' });
    expect(count).toBe(9);
  });
});
