# @flutter-ultra/flutter-ultra-native-desktop

MCP server for **native desktop UIs** that Flutter cannot reach via VM Service:
Windows UIA (FlaUI C# sidecar), macOS AXUIElement (Swift sidecar), Linux AT-SPI
(PyGObject sidecar).

This README documents the **Linux AT-SPI** path. Windows + macOS paths live in
sibling sidecars under `sidecars/win-flaui/` and `sidecars/macos-ax/`.

## Why a sidecar?

A11y bindings (`gi.repository.Atspi`, `pyobjc-framework-Accessibility`,
`FlaUI`) crash in well-known edge cases — Wayland under sandboxed apps,
permission revocation, race conditions during window creation. Hosting them
out-of-process means a single bad widget query takes down only the sidecar,
not the MCP server, hot reload, or any other Flutter Ultra tool.

The TS server pipes line-delimited JSON-RPC 2.0 over stdin/stdout of a
sidecar process per device. On crash, the cached entry is dropped and the
next tool invocation spawns a fresh sidecar.

## Tool surface (15 tools)

| Tool                | Purpose                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `get_status`        | Probe sidecar availability + binding init + display server type             |
| `get_install_hint`  | Distro-aware install command for the AT-SPI typelib + PyGObject             |
| `list_windows`      | All visible windows grouped by application (nodeId + extents)               |
| `get_active_window` | The window in AT-SPI `ACTIVE` state, or `null`                              |
| `get_node`          | Re-fetch a single accessible by nodeId                                      |
| `get_children`      | Direct children of a node                                                   |
| `get_text`          | Text via the AT-SPI `Text` interface, falling back to accessible-name       |
| `find_by_name`      | Walk subtree matching accessible-name (exact or case-insensitive substring) |
| `find_by_role`      | Walk subtree matching role-name (e.g. `push_button`, `text`, `dialog`)      |
| `find_by_id`        | Walk subtree matching developer-set id via `get_id()` or `attributes['id']` |
| `click`             | Invoke the `Action` interface (`click`/`press`/`activate`)                  |
| `double_click`      | Two clicks 80 ms apart (AT-SPI has no native double-click)                  |
| `type_text`         | Insert text via the `EditableText` interface                                |
| `grab_focus`        | Request focus via the `Component` interface                                 |
| `wait_for`          | Poll `find_by_*` until a match appears or `timeoutMs` elapses               |

## NodeId scheme

Stable string IDs of the form `"{app_idx}/{win_idx}/{path[0]}/.../{path[n]}"`
where each segment is the AT-SPI child index at that depth. IDs round-trip
across multiple requests **within the same desktop snapshot** but are NOT
durable across application restarts, focus changes, or window
creation/destruction. For durable references, re-resolve via `find_by_*`
each call.

## Display server caveats

AT-SPI works fully on **X11** because the a11y bus is a system D-Bus session
component accessible to any client process. On **Wayland** the picture is
mixed:

| Toolkit                                        | Coverage                                                        |
| ---------------------------------------------- | --------------------------------------------------------------- |
| GTK 3 / GTK 4                                  | Fully exposed                                                   |
| Qt 5 / Qt 6 with `QT_ACCESSIBILITY=1`          | Fully exposed                                                   |
| Electron with `--force-renderer-accessibility` | Fully exposed                                                   |
| Flutter Linux desktop                          | Active window only (flutter/flutter#107016) — use ultra_flutter |

The sidecar surfaces a structured warning via `get_status` whenever
`$XDG_SESSION_TYPE=wayland`. For Flutter Linux apps prefer the in-app
`ultra_flutter` binding via `@flutter-ultra/flutter-ultra-gesture` / `-runtime`.

## Installation

The sidecar requires PyGObject + the AT-SPI 2 GObject Introspection typelib.
Call `get_install_hint` from any session, or pick the distro-appropriate
command below:

| Distro family                | Command                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| Debian / Ubuntu / Mint / Pop | `sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core` |
| Fedora / RHEL / Rocky / Alma | `sudo dnf install -y python3-gobject atspi at-spi2-core`           |
| Arch / Manjaro / EndeavourOS | `sudo pacman -S --needed python-gobject at-spi2-core`              |
| openSUSE                     | `sudo zypper install -y python3-gobject typelib-1_0-Atspi-2_0`     |
| Alpine                       | `sudo apk add py3-gobject3 at-spi2-core`                           |

The sidecar prints a structured `importError` via `status` if the binding
fails to load — the message includes the import-time exception so users can
diagnose missing system packages without grepping logs.

## Device router (LocalLinuxDevice + WSL/SSH placeholders)

This package implements the `Device` interface from the (yet to ship)
`@flutter-ultra/device-router` proposal. The `LocalLinuxDevice` runs every
command via `child_process.spawn`. Once worker Q lands the router package,
`WslDevice` (`wsl.exe -d <distro> -e ...`) and `SshDevice` (`ssh user@host
...`) become drop-in replacements — every MCP tool keeps working
unchanged because the abstraction is keyed on `device.id`.

For **WSL** in particular, the Python sidecar runs inside the WSL distro
(where PyGObject + AT-SPI install cleanly via the distro package manager).
The TS server stays on Windows and pipes JSON-RPC across `wsl.exe`'s stdio.
AT-SPI inside WSL needs a desktop env with the a11y bus — WSLg (Windows 11's
built-in Wayland compositor) provides this when the user runs a Flutter
Linux app via WSLg. Pure CLI use cases don't need AT-SPI at all.

## Development

```bash
# At repo root
npm ci
npm run -w @flutter-ultra/flutter-ultra-native-desktop build
npm run -w @flutter-ultra/flutter-ultra-native-desktop test
npm run -w @flutter-ultra/flutter-ultra-native-desktop typecheck

# Python sidecar (Linux only)
cd packages/flutter-ultra-native-desktop/sidecars/linux-atspi
sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core
pip install pytest
PYTHONPATH=. pytest tests/
```

## Status

Wave 3 deliverable. Linux path complete. Live AT-SPI verification runs in the
`integration-atspi` CI job (Xvfb + at-spi-bus-launcher + a GTK accessible
tree). End-to-end driving of a real Flutter Linux app waits on wave-5
verifier or WSL remote-device support.
