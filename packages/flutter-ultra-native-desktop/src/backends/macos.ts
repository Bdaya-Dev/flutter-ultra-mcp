// macOS DesktopBackend — drives the Swift sidecar (`flutter-ultra-mac-helper`)
// over a JSON-RPC channel.
//
// The Swift helper wraps:
//   - AXUIElement (NSAccessibility) — window enumeration, a11y tree, focus
//   - CGEvent / CGEventPost — click + keyboard synthesis
//   - CoreGraphics CGWindowListCopyWindowInfo + CGWindowListCreateImage — screenshots
//   - osascript shell-outs — high-level intents (file dialog path entry)
//
// TCC: the helper checks AXIsProcessTrusted() on every call; if false, it
// returns JSON-RPC error code -32000 with a structured `data` payload the
// TS side converts into the well-known TCC_NOT_GRANTED user-facing
// remediation message.

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
} from '../types.js';
import type { Device } from '../device/types.js';
import { JsonRpcClient, JsonRpcError } from '../rpc/jsonRpcClient.js';
import type { Logger } from '@flutter-ultra/mcp-runtime';

// JSON-RPC error codes the Swift helper emits. Stay aligned with
// sidecars/macos-swift/Sources/Errors.swift.
export const MAC_ERR_TCC_NOT_GRANTED = -32_000;
export const MAC_ERR_WINDOW_NOT_FOUND = -32_001;
export const MAC_ERR_ELEMENT_NOT_FOUND = -32_002;
export const MAC_ERR_AX_FAILURE = -32_003;
export const MAC_ERR_DIALOG_TIMEOUT = -32_004;

/** Human-readable TCC remediation. Stable copy referenced by README + skill prompts. */
export const TCC_REMEDIATION = [
  'flutter-ultra needs macOS Accessibility permission to drive desktop windows.',
  '',
  'Grant it once:',
  '  1. Open the Apple menu → System Settings → Privacy & Security → Accessibility',
  "  2. Click the '+' button and add 'flutter-ultra-mac-helper'",
  '     (or drag it from your Plugin install path — printed in the log line above)',
  '  3. Toggle the switch ON next to that entry',
  '  4. Re-run this tool',
  '',
  "There is NO programmatic grant — Apple's TCC database is read-only to non-system processes.",
  'If you previously denied the request, run: tccutil reset Accessibility com.bdaya-dev.flutter-ultra-mac-helper',
  'then re-add via the steps above.',
].join('\n');

export interface MacBackendOptions {
  device: Device;
  helperPath: string;
  logger: Logger;
}

interface MacRawWindow {
  id: string;
  title: string;
  processName: string;
  pid: number;
  bounds: { x: number; y: number; width: number; height: number };
  isMain: boolean;
  isMinimized: boolean;
}

interface MacRawNode {
  id: string;
  role: string;
  title: string | null;
  label: string | null;
  value: string | null;
  enabled: boolean;
  focused: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  children: MacRawNode[];
}

interface HelloResponse {
  version: string;
  accessibilityTrusted: boolean;
  bundleId: string;
}

export class MacDesktopBackend implements DesktopBackend {
  capabilities: BackendCapabilities;
  private readonly rpc: JsonRpcClient;
  private readonly logger: Logger;

  private constructor(rpc: JsonRpcClient, capabilities: BackendCapabilities, logger: Logger) {
    this.rpc = rpc;
    this.capabilities = capabilities;
    this.logger = logger;
  }

  /**
   * Spawn the Swift helper, exchange the `hello` handshake, and probe
   * AXIsProcessTrusted(). If the helper is missing returns null; if it's
   * present but TCC is not granted, returns an instance with
   * `capabilities.permissionGranted === false` and a populated remediation.
   */
  static async create(opts: MacBackendOptions): Promise<MacDesktopBackend | null> {
    const helperExists = await opts.device.fileExists(opts.helperPath);
    if (!helperExists) {
      opts.logger.warn('mac helper missing', { path: opts.helperPath });
      return null;
    }

    const stream = await opts.device.openRpcStream(opts.helperPath, ['--rpc']);
    const rpc = new JsonRpcClient(stream, {
      defaultTimeoutMs: 30_000,
      onStderr: (line) => opts.logger.debug('mac helper stderr', { line }),
      onNotification: (note) => opts.logger.debug('mac helper notify', { method: note.method }),
    });

    let hello: HelloResponse;
    try {
      hello = await rpc.call<HelloResponse>('hello', {}, 10_000);
    } catch (err) {
      opts.logger.error('mac helper handshake failed', { err: String(err) });
      await rpc.close();
      return new MacDesktopBackend(
        // Even on handshake failure surface a capabilities-only backend so
        // the server can emit a structured registration warning.
        rpc,
        {
          platform: 'darwin',
          helperPresent: true,
          permissionGranted: false,
          waylandLimited: false,
          remediation: `Swift helper at ${opts.helperPath} failed to respond to 'hello'. Output: ${String(err)}`,
        },
        opts.logger,
      );
    }

    const remediation = hello.accessibilityTrusted ? null : TCC_REMEDIATION;
    if (!hello.accessibilityTrusted) {
      opts.logger.warn('TCC accessibility permission not granted', {
        bundleId: hello.bundleId,
      });
    } else {
      opts.logger.info('mac backend ready', {
        version: hello.version,
        bundleId: hello.bundleId,
      });
    }

    return new MacDesktopBackend(
      rpc,
      {
        platform: 'darwin',
        helperPresent: true,
        permissionGranted: hello.accessibilityTrusted,
        waylandLimited: false,
        remediation,
      },
      opts.logger,
    );
  }

  private async invoke<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (!this.capabilities.permissionGranted) {
      // Fast-fail with the same shape an in-flight call would produce so
      // tool handlers can branch on a single error type.
      throw new JsonRpcError(MAC_ERR_TCC_NOT_GRANTED, 'Accessibility permission not granted', {
        remediation: this.capabilities.remediation ?? TCC_REMEDIATION,
      });
    }
    return this.rpc.call<T>(method, params, timeoutMs);
  }

  async listWindows(opts: ListWindowsOptions): Promise<WindowDescriptor[]> {
    const raw = await this.invoke<MacRawWindow[]>('listWindows', opts);
    return raw;
  }

  async dumpWindowTree(opts: DumpWindowTreeOptions): Promise<A11yNode> {
    const raw = await this.invoke<MacRawNode>('dumpWindowTree', {
      windowId: opts.windowId,
      maxDepth: opts.maxDepth ?? 12,
    });
    return raw;
  }

  async desktopQuery(opts: DesktopQueryOptions): Promise<A11yNode[]> {
    return this.invoke<A11yNode[]>('desktopQuery', {
      windowId: opts.windowId,
      query: opts.query,
      maxResults: opts.maxResults ?? 50,
    });
  }

  async desktopClick(opts: DesktopClickOptions): Promise<{ clicked: true }> {
    return this.invoke<{ clicked: true }>('desktopClick', {
      windowId: opts.windowId,
      elementId: opts.elementId,
      x: opts.x,
      y: opts.y,
      button: opts.button ?? 'left',
      clickCount: opts.clickCount ?? 1,
    });
  }

  async desktopType(opts: DesktopTypeOptions): Promise<{ typed: true }> {
    return this.invoke<{ typed: true }>('desktopType', {
      windowId: opts.windowId,
      text: opts.text,
      elementId: opts.elementId,
      clearFirst: opts.clearFirst ?? false,
    });
  }

  async desktopScreenshot(opts: DesktopScreenshotOptions): Promise<{ pngBase64: string }> {
    return this.invoke<{ pngBase64: string }>(
      'desktopScreenshot',
      {
        windowId: opts.windowId,
        scope: opts.scope ?? 'window',
      },
      45_000,
    );
  }

  async selectFileInDialog(opts: SelectFileInDialogOptions): Promise<{ confirmed: true }> {
    return this.invoke<{ confirmed: true }>(
      'selectFileInDialog',
      {
        path: opts.path,
        confirmButton: opts.confirmButton,
        windowId: opts.windowId,
        processName: opts.processName,
      },
      45_000,
    );
  }

  async confirmDialog(
    opts: ConfirmDialogOptions,
  ): Promise<{ confirmed: true; matchedButton: string }> {
    return this.invoke<{ confirmed: true; matchedButton: string }>('confirmDialog', {
      intent: opts.intent,
      windowId: opts.windowId,
      processName: opts.processName,
    });
  }

  async waitForWindow(opts: WaitForWindowOptions): Promise<WindowDescriptor> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    return this.invoke<WindowDescriptor>(
      'waitForWindow',
      {
        titlePattern: opts.titlePattern,
        processName: opts.processName,
        timeoutMs,
        pollMs: opts.pollMs ?? 250,
      },
      // Give the helper a generous ceiling so its internal poll has time
      // to expire and surface a structured error before our RPC layer
      // does. +2s padding.
      timeoutMs + 2_000,
    );
  }

  async shutdown(): Promise<void> {
    try {
      // Best-effort polite shutdown; ignore errors.
      this.rpc.notify('shutdown');
    } catch {
      // ignore
    }
    await this.rpc.close();
    this.logger.info('mac backend shut down');
  }
}

/**
 * Convert a JsonRpcError from the Swift helper into a stable, human-readable
 * structured message including the TCC remediation when appropriate.
 */
export function describeMacError(err: unknown): string {
  if (err instanceof JsonRpcError) {
    if (err.code === MAC_ERR_TCC_NOT_GRANTED) {
      const data = err.data as { remediation?: string } | undefined;
      return data?.remediation ?? TCC_REMEDIATION;
    }
    if (err.code === MAC_ERR_WINDOW_NOT_FOUND) {
      return `${err.message}\n\nHint: call list_windows first to enumerate visible windows; the windowId may have been closed or never existed.`;
    }
    if (err.code === MAC_ERR_ELEMENT_NOT_FOUND) {
      return `${err.message}\n\nHint: call dump_window_tree or desktop_query to verify the element is in the tree before targeting it.`;
    }
    if (err.code === MAC_ERR_AX_FAILURE) {
      return `${err.message}\n\nHint: the AX call returned a Core Foundation error. The app may be sandboxed or unresponsive; try focusing it via osascript first.`;
    }
    if (err.code === MAC_ERR_DIALOG_TIMEOUT) {
      return `${err.message}\n\nHint: increase the timeout or call list_windows to confirm the dialog actually appeared.`;
    }
    return `${err.message} (code=${err.code})`;
  }
  return err instanceof Error ? err.message : String(err);
}
