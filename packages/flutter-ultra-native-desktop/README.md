# @flutter-ultra/flutter-ultra-native-desktop

Cross-platform MCP server for **native desktop UI automation** — drives the
OS-level a11y tree on macOS (AXUIElement via a Swift sidecar), Windows (UIA
via a FlaUI C# sidecar), and Linux (AT-SPI 2 via a PyGObject sidecar). Used
by Claude Code skills to introspect dialogs, click buttons, type text, and
capture window screenshots in apps that Flutter's VM service can't reach.

## Architecture

A single platform sidecar process is spawned per MCP-server lifetime. On
crash the cached entry is dropped and the next tool invocation respawns it.
Tool handlers stay platform-agnostic — the `DesktopBackend` interface
(`src/types.ts`) hides every OS-specific quirk. `src/index.ts` switches on
`process.platform` and selects `MacDesktopBackend`, `WinDesktopBackend`, or
`LinuxDesktopBackend` accordingly; the registry registers tools only when
the backend reports `helperPresent && permissionGranted`.

## Tool surface (9 tools, plan §5.6)

| Tool                    | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `list_windows`          | Visible top-level windows, optionally filtered by process / title.       |
| `dump_window_tree`      | Full a11y tree for a window, depth-bounded.                              |
| `desktop_query`         | XPath subset: `//role`, `//role[@name="X"]`, `//*[@label~="X"]`.         |
| `desktop_click`         | Click by element id (preferred) or screen coordinates.                   |
| `desktop_type`          | Type text; optionally clear field first; optional element focus.         |
| `desktop_screenshot`    | PNG (base64) — window or full screen.                                    |
| `select_file_in_dialog` | Type a path into the frontmost file dialog + click Open/Save.            |
| `confirm_dialog`        | Click a dialog button by intent (allow/deny/ok/cancel/yes/no/open/save). |
| `wait_for_window`       | Poll for a window matching title regex / process; configurable timeout.  |

Zero tools register when the per-OS sidecar is missing or the a11y bus is
unreachable (AC-ND4). Startup logs explain why so users can self-remediate.

## Linux path — AT-SPI via PyGObject

The Linux backend invokes `python3 -u -m atspi_bridge` from the package's
`sidecars/linux-atspi/` directory. The Python sidecar:

- Wraps `gi.repository.Atspi` for window enumeration, accessible-tree
  introspection, and action invocation (`Action.do_action` for click,
  `EditableText.insert_text` for type).
- Shells out to `grim` on Wayland or `scrot`/`import` on X11 for
  screenshots. Both branches required because Wayland sandboxing makes
  X11 screenshot APIs unusable.
- Shells out to `xdotool` (X11) or `ydotool` (Wayland) for
  cursor-coordinate input synthesis when AT-SPI alone can't reach a
  widget (Flutter Linux desktop is the common case — its custom-painted
  widgets don't expose the EditableText interface).

### Distro support

| Distro family                | Install command                                                    |
| ---------------------------- | ------------------------------------------------------------------ |
| Debian / Ubuntu / Mint / Pop | `sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core` |
| Fedora / RHEL / Rocky / Alma | `sudo dnf install -y python3-gobject atspi at-spi2-core`           |
| Arch / Manjaro / EndeavourOS | `sudo pacman -S --needed python-gobject at-spi2-core`              |
| openSUSE (Leap & Tumbleweed) | `sudo zypper install -y python3-gobject typelib-1_0-Atspi-2_0`     |
| Alpine                       | `sudo apk add py3-gobject3 at-spi2-core`                           |

Use the exported `detectLocalDistro()` helper to print the exact command
for the running host.

### Wayland caveat

AT-SPI works fully on **X11**. On **Wayland** the coverage varies by
toolkit:

| Toolkit                                        | Coverage                                                        |
| ---------------------------------------------- | --------------------------------------------------------------- |
| GTK 3 / GTK 4                                  | Fully exposed                                                   |
| Qt 5 / Qt 6 with `QT_ACCESSIBILITY=1`          | Fully exposed                                                   |
| Electron with `--force-renderer-accessibility` | Fully exposed                                                   |
| Flutter Linux desktop                          | Active window only (flutter/flutter#107016) — use ultra_flutter |

When `XDG_SESSION_TYPE=wayland` the backend sets `capabilities.waylandLimited
= true` so the registry can present a one-shot warning. For Flutter Linux
apps prefer the in-app `ultra_flutter` binding via
`@flutter-ultra/flutter-ultra-gesture` / `@flutter-ultra/flutter-ultra-runtime`.

### Headless / minimal compositors

Sway, river, and hyprland do NOT auto-spawn `at-spi-dbus-bus`. Enable it
explicitly:

```bash
systemctl --user enable --now at-spi-dbus-bus
```

GNOME, KDE, XFCE, MATE, and Cinnamon auto-spawn it on session start.

## Device router placeholder

The TS server consumes the `Device` interface from `src/device/types.ts`.
Today only `LocalDevice` ships; SSH and WSL `Device` implementations land
post-wave-3 in `@flutter-ultra/device-router`. The Python sidecar runs
inside the target Linux environment (local host, WSL distro, or remote
SSH-Linux); the TS server stays on the MCP host and pipes JSON-RPC across
stdio. No backend code changes when the router lands — the platform
switch in `src/index.ts` keeps using `new LocalDevice()` until the router
swaps it for `routerDevice.select(deviceId)`.

## Development

```bash
# Repo root
npm ci
npm run -w @flutter-ultra/flutter-ultra-native-desktop build
npm run -w @flutter-ultra/flutter-ultra-native-desktop test
npm run -w @flutter-ultra/flutter-ultra-native-desktop typecheck

# Python sidecar tests (Linux only)
cd packages/flutter-ultra-native-desktop/sidecars/linux-atspi
sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core
pip install pytest
PYTHONPATH=. pytest tests/
```

## CI

| Workflow                              | Purpose                                                             |
| ------------------------------------- | ------------------------------------------------------------------- |
| `.github/workflows/ci.yml`            | Cross-platform TS unit tests (ubuntu/macos/windows × Node 20/22)    |
| `.github/workflows/sidecar-macos.yml` | Build the Swift helper on macos-latest + TCC probe smoke            |
| `.github/workflows/sidecar-linux.yml` | Python sidecar pytest matrix + Xvfb-driven AT-SPI integration smoke |

## Status

Wave 3 complete. macOS path merged via PR #17 (worker-J). Linux path
shipped in this PR (worker-K). Windows path in flight (worker-I).
