// Windows DesktopBackend — drives the FlaUI C# sidecar (`flutter-ultra-win-helper.exe`)
// over the same newline-delimited JSON-RPC channel as the macOS path.
//
// The FlaUI helper wraps Windows UI Automation:
//   - FlaUI.UIA3 — window enumeration, a11y tree, click + keyboard synth via Mouse/Keyboard
//   - System.Drawing.Bitmap — window screenshots
//   - Win32 #32770 common dialog — file picker driver (AC-ND1)
//   - Win32 P/Invoke clipboard + LowLevelKeyboard for combo shortcuts
//
// Unlike macOS the Windows UIA API does not require runtime permission grants
// (no TCC equivalent), so `permissionGranted` is always true once the sidecar
// is reachable.

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

// JSON-RPC error codes the FlaUI helper emits. Intentionally aligned with
// macOS error codes for shared codes (window/element not found / dialog timeout)
// so the unified registry's error mapper can be reused. The TCC-specific code
// -32000 is unused on Windows (UIA needs no runtime permission).
export const WIN_ERR_HELPER_FAILURE = -32_000;
export const WIN_ERR_WINDOW_NOT_FOUND = -32_001;
export const WIN_ERR_ELEMENT_NOT_FOUND = -32_002;
export const WIN_ERR_UIA_FAILURE = -32_003;
export const WIN_ERR_DIALOG_TIMEOUT = -32_004;

export interface WindowsBackendOptions {
  device: Device;
  helperPath: string;
  logger: Logger;
}

interface HelloResponse {
  version: string;
  uiaInitialized: boolean;
}

export class WindowsDesktopBackend implements DesktopBackend {
  capabilities: BackendCapabilities;
  private readonly rpc: JsonRpcClient;
  private readonly logger: Logger;

  private constructor(rpc: JsonRpcClient, capabilities: BackendCapabilities, logger: Logger) {
    this.rpc = rpc;
    this.capabilities = capabilities;
    this.logger = logger;
  }

  /**
   * Spawn the FlaUI sidecar, exchange the `hello` handshake, and probe UIA
   * initialization. If the helper is missing returns null; if it's present but
   * fails handshake, returns a capabilities-only backend whose tools will
   * report a structured remediation message.
   */
  static async create(opts: WindowsBackendOptions): Promise<WindowsDesktopBackend | null> {
    const helperExists = await opts.device.fileExists(opts.helperPath);
    if (!helperExists) {
      opts.logger.warn('win helper missing', { path: opts.helperPath });
      return null;
    }

    const stream = await opts.device.openRpcStream(opts.helperPath, []);
    const rpc = new JsonRpcClient(stream, {
      defaultTimeoutMs: 30_000,
      onStderr: (line) => opts.logger.debug('win helper stderr', { line }),
      onNotification: (note) => opts.logger.debug('win helper notify', { method: note.method }),
    });

    let hello: HelloResponse;
    try {
      hello = await rpc.call<HelloResponse>('hello', {}, 10_000);
    } catch (err) {
      opts.logger.error('win helper handshake failed', { err: String(err) });
      await rpc.close();
      return new WindowsDesktopBackend(
        rpc,
        {
          platform: 'win32',
          helperPresent: true,
          permissionGranted: false,
          waylandLimited: false,
          remediation:
            `FlaUI sidecar at ${opts.helperPath} failed to respond to 'hello'. Output: ${String(err)}. ` +
            'Verify the sidecar was built with `npm run build:sidecar:windows` and is on this host.',
        },
        opts.logger,
      );
    }

    if (!hello.uiaInitialized) {
      opts.logger.warn('UIA not initialized in sidecar', { version: hello.version });
      return new WindowsDesktopBackend(
        rpc,
        {
          platform: 'win32',
          helperPresent: true,
          permissionGranted: false,
          waylandLimited: false,
          remediation:
            'FlaUI sidecar started but reported uiaInitialized=false. UI Automation may be ' +
            'unavailable on this host (Server Core SKU, missing UIAutomationCore.dll).',
        },
        opts.logger,
      );
    }

    opts.logger.info('windows backend ready', { version: hello.version });
    return new WindowsDesktopBackend(
      rpc,
      {
        platform: 'win32',
        helperPresent: true,
        permissionGranted: true,
        waylandLimited: false,
        remediation: null,
      },
      opts.logger,
    );
  }

  private async invoke<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (!this.capabilities.permissionGranted) {
      throw new JsonRpcError(WIN_ERR_HELPER_FAILURE, 'FlaUI sidecar unavailable', {
        remediation: this.capabilities.remediation,
      });
    }
    return this.rpc.call<T>(method, params, timeoutMs);
  }

  async listWindows(opts: ListWindowsOptions): Promise<WindowDescriptor[]> {
    return this.invoke<WindowDescriptor[]>('listWindows', opts);
  }

  async dumpWindowTree(opts: DumpWindowTreeOptions): Promise<A11yNode> {
    return this.invoke<A11yNode>('dumpWindowTree', {
      windowId: opts.windowId,
      maxDepth: opts.maxDepth ?? 12,
    });
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
      timeoutMs + 2_000,
    );
  }

  async shutdown(): Promise<void> {
    try {
      this.rpc.notify('shutdown');
    } catch {
      // ignore
    }
    await this.rpc.close();
    this.logger.info('windows backend shut down');
  }
}

/**
 * Convert a JsonRpcError from the FlaUI helper into a stable, human-readable
 * structured message. Mirrors `describeMacError` in shape so the unified
 * registry can be wired to either via a generic dispatcher post-merge.
 */
export function describeWindowsError(err: unknown): string {
  if (err instanceof JsonRpcError) {
    if (err.code === WIN_ERR_WINDOW_NOT_FOUND) {
      return `${err.message}\n\nHint: call list_windows first to enumerate visible windows; the windowId may have been closed or never existed.`;
    }
    if (err.code === WIN_ERR_ELEMENT_NOT_FOUND) {
      return `${err.message}\n\nHint: call dump_window_tree or desktop_query to verify the element is in the tree before targeting it.`;
    }
    if (err.code === WIN_ERR_UIA_FAILURE) {
      return `${err.message}\n\nHint: the FlaUI/UIA call failed. The target app may be elevated (requires admin) or unresponsive.`;
    }
    if (err.code === WIN_ERR_DIALOG_TIMEOUT) {
      return `${err.message}\n\nHint: increase the timeout or call list_windows to confirm the dialog actually appeared.`;
    }
    if (err.code === WIN_ERR_HELPER_FAILURE) {
      const data = err.data as { remediation?: string | null } | undefined;
      return data?.remediation ?? err.message;
    }
    return `${err.message} (code=${err.code})`;
  }
  return err instanceof Error ? err.message : String(err);
}
