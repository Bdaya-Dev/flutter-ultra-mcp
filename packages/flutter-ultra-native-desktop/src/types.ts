// Shared types for the native-desktop server.
//
// Tool surface (plan §5.6, identical across OS paths):
//   list_windows, dump_window_tree, desktop_query, desktop_click,
//   desktop_type, desktop_screenshot, select_file_in_dialog,
//   confirm_dialog, wait_for_window.
//
// Each OS path implements the same `DesktopBackend` interface; the server
// constructor picks the backend at startup based on platform detection and
// helper availability. AC-ND4: if the per-OS helper is missing or permission
// not granted, ZERO tools register and a clear warning is logged.

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowDescriptor {
  id: string;
  title: string;
  processName: string;
  pid: number;
  bounds: WindowBounds;
  isMain: boolean;
  isMinimized: boolean;
}

export interface A11yNode {
  id: string;
  role: string;
  title: string | null;
  label: string | null;
  value: string | null;
  enabled: boolean;
  focused: boolean;
  bounds: WindowBounds;
  children: A11yNode[];
}

export interface BackendCapabilities {
  platform: 'darwin' | 'win32' | 'linux';
  // True when the OS sidecar binary is available + version-compatible.
  helperPresent: boolean;
  // True when accessibility permissions are granted (macOS TCC, Linux AT-SPI bus, Win UIA).
  permissionGranted: boolean;
  // Wayland-degradation flag (Linux only; false elsewhere).
  waylandLimited: boolean;
  // Human-readable remediation message when helperPresent || permissionGranted is false.
  remediation: string | null;
}

// ─────────────────────────── backend interface ─────────────────────────────
//
// All option fields use `| undefined` explicitly so the strict
// `exactOptionalPropertyTypes` setting permits caller-side destructured
// shapes that may omit a key entirely.

export interface DesktopBackend {
  readonly capabilities: BackendCapabilities;
  listWindows(opts: ListWindowsOptions): Promise<WindowDescriptor[]>;
  dumpWindowTree(opts: DumpWindowTreeOptions): Promise<A11yNode>;
  desktopQuery(opts: DesktopQueryOptions): Promise<A11yNode[]>;
  desktopClick(opts: DesktopClickOptions): Promise<{ clicked: true }>;
  desktopType(opts: DesktopTypeOptions): Promise<{ typed: true }>;
  desktopScreenshot(opts: DesktopScreenshotOptions): Promise<{ pngBase64: string }>;
  selectFileInDialog(opts: SelectFileInDialogOptions): Promise<{ confirmed: true }>;
  confirmDialog(opts: ConfirmDialogOptions): Promise<{ confirmed: true; matchedButton: string }>;
  waitForWindow(opts: WaitForWindowOptions): Promise<WindowDescriptor>;
  /**
   * Format a backend error (typically a JsonRpcError from the OS sidecar)
   * into a human-readable string including OS-specific remediation hints.
   * Optional — registry falls back to a generic stringifier when omitted.
   */
  describeError?(err: unknown): string;
  shutdown(): Promise<void>;
}

export interface ListWindowsOptions {
  processName?: string | undefined;
  titlePattern?: string | undefined;
}

export interface DumpWindowTreeOptions {
  windowId: string;
  maxDepth?: number | undefined;
}

export interface DesktopQueryOptions {
  windowId: string;
  // Backends interpret a small XPath subset:
  //   //role[@name="X"]  →  any descendant with role=role and name=X
  //   //role             →  any descendant with role=role
  //   //*[@label~="X"]   →  any descendant whose label contains X
  query: string;
  maxResults?: number | undefined;
}

export interface DesktopClickOptions {
  // Either targets by a11y id or by screen coordinates. Backends prefer id.
  windowId: string;
  elementId?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  button?: 'left' | 'right' | 'middle' | undefined;
  clickCount?: 1 | 2 | 3 | undefined;
}

export interface DesktopTypeOptions {
  windowId: string;
  text: string;
  // Optional element to focus first; if omitted, types into currently-focused widget.
  elementId?: string | undefined;
  // True to clear field via Cmd+A / Delete before typing.
  clearFirst?: boolean | undefined;
}

export interface DesktopScreenshotOptions {
  windowId: string;
  // If true, screenshot the window's bounds; else screenshot the screen containing it.
  scope?: 'window' | 'screen' | undefined;
}

export interface SelectFileInDialogOptions {
  path: string;
  // Confirm button override (default backend picks "Open" / "Save" / "Choose").
  confirmButton?: string | undefined;
  // Optional window id of the file dialog; backends auto-detect if omitted.
  windowId?: string | undefined;
  // Optional process name to scope auto-detection.
  processName?: string | undefined;
}

export interface ConfirmDialogOptions {
  intent: 'allow' | 'deny' | 'ok' | 'cancel' | 'yes' | 'no' | 'open' | 'save';
  // Optional window id; backends auto-detect by frontmost-modal heuristic if omitted.
  windowId?: string | undefined;
  processName?: string | undefined;
}

export interface WaitForWindowOptions {
  titlePattern?: string | undefined;
  processName?: string | undefined;
  // Max wait time in ms; defaults to 30_000.
  timeoutMs?: number | undefined;
  // Poll interval; defaults to 250ms.
  pollMs?: number | undefined;
}
