// DesktopBackend — platform-agnostic facade over the per-platform a11y
// binding (AT-SPI on Linux, FlaUI on Windows, AXUIElement on macOS).
//
// The convergence target across workers I/J/K. tools.ts dispatches via
// this interface so platform-specific code lives behind a single seam.
// When the shared @flutter-ultra/desktop-types package lands, this file
// becomes a re-export from there.
//
// camelCase across the wire — JSON-RPC method names on the Linux sidecar
// stay snake_case to match Python conventions, but the TS-side facade
// presents camelCase to keep parity with the Windows + macOS backends.

export interface AccessibleNode {
  nodeId: string;
  name: string | null;
  role: string | null;
  description: string | null;
  childCount: number;
  attributes: Record<string, string>;
  states: string[];
  extents?: { x: number; y: number; width: number; height: number };
}

export interface WindowGroup {
  appIndex: number;
  appName: string;
  windows: AccessibleNode[];
}

export interface ListWindowsResult {
  apps: WindowGroup[];
  waylandWarning?: string | null;
}

export interface BackendStatus {
  bindingAvailable: boolean;
  bindingInitialised: boolean;
  platformNotes: string[];
  // Linux-only: display server info + structured Wayland warning.
  session?: { sessionType: string; display: string | null; desktop: string | null };
  waylandWarning?: string | null;
  importError?: string | null;
}

export interface FindCriteria {
  // Discriminated by `type`. The matching field must be set:
  //   { type: 'name', name: 'OK', exact: true, rootNodeId?: '0/0' }
  //   { type: 'role', role: 'push_button' }
  //   { type: 'id',   id: 'submit-btn' }
  type: 'name' | 'role' | 'id';
  name?: string;
  role?: string;
  id?: string;
  exact?: boolean;
  rootNodeId?: string;
}

export interface ActionResult {
  success: boolean;
  actionIndex?: number;
  wrote?: string;
  first?: ActionResult;
  second?: ActionResult;
}

export interface WaitResult {
  matched: boolean;
  matches: AccessibleNode[];
}

/**
 * Per-platform native desktop accessibility backend.
 *
 * Linux:   wraps the Python AT-SPI sidecar (this package).
 * Windows: wraps the FlaUI C# sidecar (sibling package, worker I).
 * macOS:   wraps the Swift AX sidecar (sibling package, worker J).
 */
export interface DesktopBackend {
  status(): Promise<BackendStatus>;
  listWindows(): Promise<ListWindowsResult>;
  getActiveWindow(): Promise<AccessibleNode | null>;
  getNode(nodeId: string): Promise<AccessibleNode>;
  getChildren(nodeId: string): Promise<{ children: AccessibleNode[] }>;
  getText(nodeId: string): Promise<{ text: string }>;
  findByName(
    name: string,
    options?: { exact?: boolean; rootNodeId?: string },
  ): Promise<{ matches: AccessibleNode[] }>;
  findByRole(
    role: string,
    options?: { rootNodeId?: string },
  ): Promise<{ matches: AccessibleNode[] }>;
  findById(id: string, options?: { rootNodeId?: string }): Promise<{ matches: AccessibleNode[] }>;
  click(nodeId: string): Promise<ActionResult>;
  doubleClick(nodeId: string): Promise<ActionResult>;
  typeText(nodeId: string, text: string, options?: { clear?: boolean }): Promise<ActionResult>;
  grabFocus(nodeId: string): Promise<ActionResult>;
  waitFor(
    criteria: FindCriteria,
    options?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<WaitResult>;
  dispose(): Promise<void>;
}
