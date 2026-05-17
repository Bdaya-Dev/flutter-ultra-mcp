// Linux DesktopBackend — drives the Python AT-SPI sidecar
// (`atspi_bridge`) over a JSON-RPC channel.
//
// The Python sidecar wraps:
//   - gi.repository.Atspi — window enumeration, a11y tree, action invocation
//   - grim / scrot / import — screenshot capture (Wayland / X11)
//   - xdotool / ydotool    — cursor-coordinate input synthesis fallback
//
// Permission model: AT-SPI requires the session a11y bus to be running. On
// most desktops (GNOME, KDE, GTK-based) this is automatic; on minimal
// Wayland compositors (sway, river, hyprland) the user must enable it.
// The Python sidecar's `hello` response carries `permissionGranted: false`
// + a structured remediation when the bus is unreachable.

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

// JSON-RPC error codes the Python sidecar emits. Stay aligned with
// sidecars/linux-atspi/atspi_bridge/desktop_api.py.
export const LINUX_ERR_PERMISSION_NOT_GRANTED = -32_000;
export const LINUX_ERR_WINDOW_NOT_FOUND = -32_001;
export const LINUX_ERR_ELEMENT_NOT_FOUND = -32_002;
export const LINUX_ERR_AT_SPI_FAILURE = -32_003;
export const LINUX_ERR_DIALOG_TIMEOUT = -32_004;
export const LINUX_ERR_SCREENSHOT_TOOL_MISSING = -32_010;
export const LINUX_ERR_INPUT_TOOL_MISSING = -32_011;
export const LINUX_ERR_UNSUPPORTED_QUERY = -32_012;
export const LINUX_ERR_WAYLAND_LIMITATION = -32_013;

/** Human-readable AT-SPI bus remediation. Stable copy referenced by README + skill prompts. */
export const ATSPI_BUS_REMEDIATION = [
  'flutter-ultra needs the Linux AT-SPI 2 accessibility bus to drive desktop windows.',
  '',
  'Install once (per distro):',
  '  Debian / Ubuntu : sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core',
  '  Fedora / RHEL   : sudo dnf install -y python3-gobject atspi at-spi2-core',
  '  Arch / Manjaro  : sudo pacman -S --needed python-gobject at-spi2-core',
  '  openSUSE        : sudo zypper install -y python3-gobject typelib-1_0-Atspi-2_0',
  '  Alpine          : sudo apk add py3-gobject3 at-spi2-core',
  '',
  'On Wayland compositors that do NOT auto-spawn the a11y bus (sway/river/',
  'hyprland) start it explicitly:',
  '  systemctl --user enable --now at-spi-dbus-bus',
  '',
  'Then re-run this tool.',
].join('\n');

export interface LinuxBackendOptions {
  device: Device;
  sidecarPath: string;
  pythonBin?: string;
  logger: Logger;
}

interface HelloResponse {
  version: string;
  helperPresent: boolean;
  permissionGranted: boolean;
  waylandLimited: boolean;
  remediation: string | null;
  bindingVersion?: Record<string, string>;
  session: {
    sessionType: string;
    display: string | null;
    waylandDisplay: string | null;
    desktop: string | null;
  };
}

interface RawWindow {
  id: string;
  title: string;
  processName: string;
  pid: number;
  bounds: { x: number; y: number; width: number; height: number };
  isMain: boolean;
  isMinimized: boolean;
}

interface RawNode {
  id: string;
  role: string;
  title: string | null;
  label: string | null;
  value: string | null;
  enabled: boolean;
  focused: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  children: RawNode[];
}

export class LinuxDesktopBackend implements DesktopBackend {
  capabilities: BackendCapabilities;
  private readonly rpc: JsonRpcClient;
  private readonly logger: Logger;

  private constructor(rpc: JsonRpcClient, capabilities: BackendCapabilities, logger: Logger) {
    this.rpc = rpc;
    this.capabilities = capabilities;
    this.logger = logger;
  }

  /**
   * Spawn the Python sidecar, exchange the `hello` handshake, and probe
   * the AT-SPI bus. If the sidecar directory is missing returns null; if
   * the binding is present but the a11y bus is unreachable, returns an
   * instance with `capabilities.permissionGranted === false` and a
   * populated remediation message.
   */
  static async create(opts: LinuxBackendOptions): Promise<LinuxDesktopBackend | null> {
    // The "sidecar path" here is the directory containing atspi_bridge/.
    // Detect presence via the package's __main__.py.
    const moduleEntry = `${opts.sidecarPath.replace(/[\\/]+$/, '')}/atspi_bridge/__main__.py`;
    const sidecarExists = await opts.device.fileExists(moduleEntry);
    if (!sidecarExists) {
      opts.logger.warn('linux atspi sidecar missing', {
        path: moduleEntry,
        remediation:
          'install python3-gi + gir1.2-atspi-2.0 then ensure the package ' +
          `directory at ${opts.sidecarPath} is reachable, or set ` +
          'FLUTTER_ULTRA_LINUX_HELPER to a custom location.',
      });
      return null;
    }

    const pythonBin = opts.pythonBin ?? 'python3';
    const stream = await opts.device.openRpcStream(pythonBin, ['-u', '-m', 'atspi_bridge'], {
      env: {
        PYTHONPATH: opts.sidecarPath,
        PYTHONUNBUFFERED: '1',
      },
    });
    const rpc = new JsonRpcClient(stream, {
      defaultTimeoutMs: 30_000,
      onStderr: (line) => opts.logger.debug('linux sidecar stderr', { line }),
      onNotification: (note) => opts.logger.debug('linux sidecar notify', { method: note.method }),
    });

    let hello: HelloResponse;
    try {
      hello = await rpc.call<HelloResponse>('hello', {}, 10_000);
    } catch (err) {
      opts.logger.error('linux sidecar handshake failed', { err: String(err) });
      await rpc.close();
      return new LinuxDesktopBackend(
        rpc,
        {
          platform: 'linux',
          helperPresent: true,
          permissionGranted: false,
          waylandLimited: false,
          remediation:
            `Python sidecar at ${opts.sidecarPath} failed to respond to 'hello'. ` +
            `Output: ${String(err)}`,
        },
        opts.logger,
      );
    }

    const remediation = hello.permissionGranted
      ? (hello.remediation ?? null)
      : (hello.remediation ?? ATSPI_BUS_REMEDIATION);
    if (!hello.permissionGranted) {
      opts.logger.warn('AT-SPI bus not reachable', {
        session: hello.session,
        bindingPresent: hello.helperPresent,
      });
    } else {
      opts.logger.info('linux backend ready', {
        version: hello.version,
        session: hello.session,
        waylandLimited: hello.waylandLimited,
        bindingVersion: hello.bindingVersion,
      });
    }

    return new LinuxDesktopBackend(
      rpc,
      {
        platform: 'linux',
        helperPresent: hello.helperPresent,
        permissionGranted: hello.permissionGranted,
        waylandLimited: hello.waylandLimited,
        remediation,
      },
      opts.logger,
    );
  }

  private async invoke<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (!this.capabilities.permissionGranted) {
      throw new JsonRpcError(LINUX_ERR_PERMISSION_NOT_GRANTED, 'AT-SPI bus not reachable', {
        remediation: this.capabilities.remediation ?? ATSPI_BUS_REMEDIATION,
      });
    }
    return this.rpc.call<T>(method, params, timeoutMs);
  }

  async listWindows(opts: ListWindowsOptions): Promise<WindowDescriptor[]> {
    return this.invoke<RawWindow[]>('listWindows', opts);
  }

  async dumpWindowTree(opts: DumpWindowTreeOptions): Promise<A11yNode> {
    return this.invoke<RawNode>('dumpWindowTree', {
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

  describeError(err: unknown): string {
    return describeLinuxError(err);
  }

  async shutdown(): Promise<void> {
    try {
      this.rpc.notify('shutdown');
    } catch {
      // ignore
    }
    await this.rpc.close();
    this.logger.info('linux backend shut down');
  }
}

/**
 * Convert a JsonRpcError from the Python sidecar into a stable,
 * human-readable structured message including the AT-SPI remediation
 * when appropriate.
 */
export function describeLinuxError(err: unknown): string {
  if (err instanceof JsonRpcError) {
    if (err.code === LINUX_ERR_PERMISSION_NOT_GRANTED) {
      const data = err.data as { remediation?: string } | undefined;
      return data?.remediation ?? ATSPI_BUS_REMEDIATION;
    }
    if (err.code === LINUX_ERR_WINDOW_NOT_FOUND) {
      return `${err.message}\n\nHint: call list_windows first to enumerate visible windows; the windowId may have been closed or never existed.`;
    }
    if (err.code === LINUX_ERR_ELEMENT_NOT_FOUND) {
      return `${err.message}\n\nHint: call dump_window_tree or desktop_query to verify the element is in the tree before targeting it. AT-SPI may not expose the element if the app's accessibility integration is incomplete.`;
    }
    if (err.code === LINUX_ERR_AT_SPI_FAILURE) {
      return `${err.message}\n\nHint: the AT-SPI call returned a GLib error. The app may be unresponsive or its a11y bridge may have detached; try focusing it manually first.`;
    }
    if (err.code === LINUX_ERR_DIALOG_TIMEOUT) {
      return `${err.message}\n\nHint: increase the timeout or call list_windows to confirm the dialog actually appeared.`;
    }
    if (err.code === LINUX_ERR_SCREENSHOT_TOOL_MISSING) {
      return `${err.message}\n\nHint: install via your distro package manager.\n  Debian/Ubuntu: sudo apt-get install -y scrot\n  Fedora: sudo dnf install -y scrot\n  Wayland (sway/river/hyprland): sudo apt-get install -y grim (or your distro equivalent).`;
    }
    if (err.code === LINUX_ERR_INPUT_TOOL_MISSING) {
      return `${err.message}\n\nHint: install xdotool (X11) or ydotool (Wayland) via your distro package manager. Note: ydotool needs uinput permission — add yourself to the 'input' group OR run via systemd unit with CAP_BPF.`;
    }
    if (err.code === LINUX_ERR_UNSUPPORTED_QUERY) {
      return `${err.message}\n\nHint: supported subset is //role, //role[@name="X"], //*[@label~="X"]. Use dump_window_tree to walk the full tree if you need richer matching.`;
    }
    if (err.code === LINUX_ERR_WAYLAND_LIMITATION) {
      return `${err.message}\n\nHint: AT-SPI coverage is limited on Wayland for some toolkits. For Flutter apps prefer the in-app ultra_flutter binding via flutter-ultra-gesture / flutter-ultra-runtime.`;
    }
    return `${err.message} (code=${err.code})`;
  }
  return err instanceof Error ? err.message : String(err);
}
