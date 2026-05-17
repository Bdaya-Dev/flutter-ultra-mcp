import { describe, expect, it, vi } from 'vitest';
import { LinuxDesktopBackend } from '../src/linux-backend.js';
import type { Device } from '../src/device.js';
import type { Sidecar, SidecarRegistry } from '../src/sidecar.js';

function fakeDevice(): Device {
  return {
    id: 'local',
    kind: 'local',
    platform: 'linux',
    exec: vi.fn(),
    spawn: vi.fn(),
    uploadFile: vi.fn(),
    downloadFile: vi.fn(),
    forwardTcpPort: vi.fn(),
    probe: vi.fn(),
    close: vi.fn(),
  } as unknown as Device;
}

function fakeSidecarRegistry(call: ReturnType<typeof vi.fn>): SidecarRegistry {
  const sidecar = { call, isAlive: () => true, dispose: vi.fn() } as unknown as Sidecar;
  return {
    get: vi.fn().mockResolvedValue(sidecar),
    disposeAll: vi.fn(),
  } as unknown as SidecarRegistry;
}

describe('LinuxDesktopBackend', () => {
  it('translates status() camelCase → atspi snake_case', async () => {
    const call = vi.fn().mockResolvedValue({
      atspiAvailable: true,
      atspiInitialised: true,
      session: { sessionType: 'x11', display: ':0', waylandDisplay: null, desktop: 'XFCE' },
      waylandWarning: null,
      bindingVersion: { atspi: '2.50' },
    });
    const backend = new LinuxDesktopBackend(fakeDevice(), fakeSidecarRegistry(call));
    const status = await backend.status();
    expect(call).toHaveBeenCalledWith('status', {});
    expect(status.bindingAvailable).toBe(true);
    expect(status.bindingInitialised).toBe(true);
    expect(status.session).toEqual({ sessionType: 'x11', display: ':0', desktop: 'XFCE' });
    expect(status.waylandWarning).toBeNull();
  });

  it('translates listWindows() to list_windows RPC', async () => {
    const call = vi.fn().mockResolvedValue({ apps: [] });
    const backend = new LinuxDesktopBackend(fakeDevice(), fakeSidecarRegistry(call));
    const result = await backend.listWindows();
    expect(call).toHaveBeenCalledWith('list_windows', {});
    expect(result.apps).toEqual([]);
  });

  it('passes nodeId through getNode / getChildren / getText / click', async () => {
    const call = vi.fn().mockResolvedValue({});
    const backend = new LinuxDesktopBackend(fakeDevice(), fakeSidecarRegistry(call));
    await backend.getNode('0/1');
    await backend.getChildren('0/1');
    await backend.getText('0/1');
    await backend.click('0/1');
    await backend.doubleClick('0/1');
    await backend.grabFocus('0/1');
    expect(call).toHaveBeenNthCalledWith(1, 'get_node', { nodeId: '0/1' });
    expect(call).toHaveBeenNthCalledWith(2, 'get_children', { nodeId: '0/1' });
    expect(call).toHaveBeenNthCalledWith(3, 'get_text', { nodeId: '0/1' });
    expect(call).toHaveBeenNthCalledWith(4, 'click', { nodeId: '0/1' });
    expect(call).toHaveBeenNthCalledWith(5, 'double_click', { nodeId: '0/1' });
    expect(call).toHaveBeenNthCalledWith(6, 'grab_focus', { nodeId: '0/1' });
  });

  it('omits undefined optional params in findByName', async () => {
    const call = vi.fn().mockResolvedValue({ matches: [] });
    const backend = new LinuxDesktopBackend(fakeDevice(), fakeSidecarRegistry(call));
    await backend.findByName('OK');
    expect(call).toHaveBeenLastCalledWith('find_by_name', { name: 'OK' });
    await backend.findByName('OK', { exact: false, rootNodeId: '0/0' });
    expect(call).toHaveBeenLastCalledWith('find_by_name', {
      name: 'OK',
      exact: false,
      rootNodeId: '0/0',
    });
  });

  it('passes typeText params including clear flag', async () => {
    const call = vi.fn().mockResolvedValue({ success: true, wrote: 'hello' });
    const backend = new LinuxDesktopBackend(fakeDevice(), fakeSidecarRegistry(call));
    await backend.typeText('0/1', 'hello', { clear: true });
    expect(call).toHaveBeenLastCalledWith('type_text', {
      nodeId: '0/1',
      text: 'hello',
      clear: true,
    });
  });

  it('passes waitFor criteria + timeout', async () => {
    const call = vi.fn().mockResolvedValue({ matched: true, matches: [] });
    const backend = new LinuxDesktopBackend(fakeDevice(), fakeSidecarRegistry(call));
    await backend.waitFor(
      { type: 'name', name: 'OK', exact: true },
      { timeoutMs: 2000, pollIntervalMs: 100 },
    );
    expect(call).toHaveBeenLastCalledWith('wait_for', {
      criteria: { type: 'name', name: 'OK', exact: true },
      timeoutMs: 2000,
      pollIntervalMs: 100,
    });
  });
});
