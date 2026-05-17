// LinuxDesktopBackend — implements DesktopBackend over the Python AT-SPI
// sidecar's snake_case JSON-RPC surface. Translates camelCase method
// names + result shapes to/from what the sidecar speaks.

import type {
  AccessibleNode,
  ActionResult,
  BackendStatus,
  DesktopBackend,
  FindCriteria,
  ListWindowsResult,
  WaitResult,
} from './backend.js';
import type { Device } from './device.js';
import type { SidecarRegistry } from './sidecar.js';

interface SidecarStatusResult {
  atspiAvailable: boolean;
  atspiInitialised: boolean;
  session: {
    sessionType: string;
    display: string | null;
    waylandDisplay: string | null;
    desktop: string | null;
  };
  waylandWarning?: string | null;
  importError?: string | null;
  bindingVersion?: Record<string, string>;
}

export class LinuxDesktopBackend implements DesktopBackend {
  constructor(
    private readonly device: Device,
    private readonly sidecars: SidecarRegistry,
  ) {}

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const sidecar = await this.sidecars.get(this.device);
    return sidecar.call(method, params) as Promise<T>;
  }

  async status(): Promise<BackendStatus> {
    const raw = await this.call<SidecarStatusResult>('status');
    const out: BackendStatus = {
      bindingAvailable: raw.atspiAvailable,
      bindingInitialised: raw.atspiInitialised,
      platformNotes: [],
      waylandWarning: raw.waylandWarning ?? null,
      importError: raw.importError ?? null,
    };
    if (raw.session) {
      out.session = {
        sessionType: raw.session.sessionType,
        display: raw.session.display ?? raw.session.waylandDisplay,
        desktop: raw.session.desktop,
      };
    }
    return out;
  }

  listWindows(): Promise<ListWindowsResult> {
    return this.call<ListWindowsResult>('list_windows');
  }

  getActiveWindow(): Promise<AccessibleNode | null> {
    return this.call<AccessibleNode | null>('get_active_window');
  }

  getNode(nodeId: string): Promise<AccessibleNode> {
    return this.call<AccessibleNode>('get_node', { nodeId });
  }

  getChildren(nodeId: string): Promise<{ children: AccessibleNode[] }> {
    return this.call<{ children: AccessibleNode[] }>('get_children', { nodeId });
  }

  getText(nodeId: string): Promise<{ text: string }> {
    return this.call<{ text: string }>('get_text', { nodeId });
  }

  findByName(
    name: string,
    options: { exact?: boolean; rootNodeId?: string } = {},
  ): Promise<{ matches: AccessibleNode[] }> {
    const params: Record<string, unknown> = { name };
    if (options.exact !== undefined) params.exact = options.exact;
    if (options.rootNodeId !== undefined) params.rootNodeId = options.rootNodeId;
    return this.call<{ matches: AccessibleNode[] }>('find_by_name', params);
  }

  findByRole(
    role: string,
    options: { rootNodeId?: string } = {},
  ): Promise<{ matches: AccessibleNode[] }> {
    const params: Record<string, unknown> = { role };
    if (options.rootNodeId !== undefined) params.rootNodeId = options.rootNodeId;
    return this.call<{ matches: AccessibleNode[] }>('find_by_role', params);
  }

  findById(
    id: string,
    options: { rootNodeId?: string } = {},
  ): Promise<{ matches: AccessibleNode[] }> {
    const params: Record<string, unknown> = { id };
    if (options.rootNodeId !== undefined) params.rootNodeId = options.rootNodeId;
    return this.call<{ matches: AccessibleNode[] }>('find_by_id', params);
  }

  click(nodeId: string): Promise<ActionResult> {
    return this.call<ActionResult>('click', { nodeId });
  }

  doubleClick(nodeId: string): Promise<ActionResult> {
    return this.call<ActionResult>('double_click', { nodeId });
  }

  typeText(nodeId: string, text: string, options: { clear?: boolean } = {}): Promise<ActionResult> {
    const params: Record<string, unknown> = { nodeId, text };
    if (options.clear !== undefined) params.clear = options.clear;
    return this.call<ActionResult>('type_text', params);
  }

  grabFocus(nodeId: string): Promise<ActionResult> {
    return this.call<ActionResult>('grab_focus', { nodeId });
  }

  waitFor(
    criteria: FindCriteria,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<WaitResult> {
    const params: Record<string, unknown> = { criteria };
    if (options.timeoutMs !== undefined) params.timeoutMs = options.timeoutMs;
    if (options.pollIntervalMs !== undefined) params.pollIntervalMs = options.pollIntervalMs;
    return this.call<WaitResult>('wait_for', params);
  }

  async dispose(): Promise<void> {
    // SidecarRegistry owns the sidecar lifecycle. Nothing to do here; the
    // server's onclose handler triggers SidecarRegistry.disposeAll().
  }
}
