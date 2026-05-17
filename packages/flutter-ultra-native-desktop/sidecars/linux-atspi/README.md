# atspi_bridge — Linux AT-SPI sidecar

JSON-RPC 2.0 stdio sidecar invoked by
`@flutter-ultra/flutter-ultra-native-desktop`. Exposes the AT-SPI 2
accessible-object tree to the TS MCP server.

## Architecture

```
flutter-ultra-native-desktop (Node, TS)
  |
  | spawn: python3 -u -m atspi_bridge
  | stdio: line-delimited JSON-RPC 2.0
  v
atspi_bridge.__main__
  |
  | gi.repository.Atspi
  | gi.repository.GLib
  v
at-spi2-core (D-Bus session a11y bus)
  |
  v
running GTK / Qt / Flutter Linux apps
```

One sidecar process per `Device.id` for the lifetime of the MCP server.
On crash, the TS-side `SidecarRegistry` drops the cached entry and the
next tool call spawns a fresh sidecar.

## Install

The sidecar imports `gi.repository.Atspi` at runtime. Install via the
distro package manager — `pip install PyGObject` alone is insufficient
because the GObject Introspection typelib is shipped separately:

| Distro                       | Command                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| Debian / Ubuntu / Mint / Pop | `sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core` |
| Fedora / RHEL / Rocky / Alma | `sudo dnf install -y python3-gobject atspi at-spi2-core`           |
| Arch / Manjaro / EndeavourOS | `sudo pacman -S --needed python-gobject at-spi2-core`              |
| openSUSE                     | `sudo zypper install -y python3-gobject typelib-1_0-Atspi-2_0`     |
| Alpine                       | `sudo apk add py3-gobject3 at-spi2-core`                           |

## Run standalone (debugging)

```bash
# From the sidecar directory:
PYTHONPATH=. /usr/bin/python3 -u -m atspi_bridge

# Then paste a JSON request followed by a newline:
{"jsonrpc":"2.0","id":1,"method":"status"}
```

A line of structured JSON appears on stdout. Stderr carries structured log
lines (`{"level": "info", "msg": "...", ...}`).

## Method reference

All methods take JSON object params. Returns a JSON-RPC 2.0 response.

| Method              | Params                                                                  | Returns                                         |
| ------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| `status`            | `{}`                                                                    | `{atspiAvailable, atspiInitialised, session}`   |
| `list_windows`      | `{}`                                                                    | `{apps: [{appIndex, appName, windows: [...]}]}` |
| `get_active_window` | `{}`                                                                    | accessible node or `null`                       |
| `get_node`          | `{nodeId}`                                                              | accessible node                                 |
| `get_children`      | `{nodeId}`                                                              | `{children: [...]}`                             |
| `get_text`          | `{nodeId}`                                                              | `{text}`                                        |
| `find_by_name`      | `{name, exact?, rootNodeId?}`                                           | `{matches: [...]}`                              |
| `find_by_role`      | `{role, rootNodeId?}`                                                   | `{matches: [...]}`                              |
| `find_by_id`        | `{id, rootNodeId?}`                                                     | `{matches: [...]}`                              |
| `click`             | `{nodeId}`                                                              | `{actionIndex, success}`                        |
| `double_click`      | `{nodeId}`                                                              | `{first, second}`                               |
| `type_text`         | `{nodeId, text, clear?}`                                                | `{success, wrote}`                              |
| `grab_focus`        | `{nodeId}`                                                              | `{success}`                                     |
| `wait_for`          | `{criteria: {type, name?/role?/id?, ...}, timeoutMs?, pollIntervalMs?}` | `{matched, matches}`                            |

## Error codes

| Code     | Constant                 | Meaning                                                      |
| -------- | ------------------------ | ------------------------------------------------------------ |
| `-32700` | `PARSE_ERROR`            | Stdin line was not valid JSON                                |
| `-32600` | `INVALID_REQUEST`        | Request did not match JSON-RPC 2.0 shape                     |
| `-32601` | `METHOD_NOT_FOUND`       | No handler for the requested method                          |
| `-32602` | `INVALID_PARAMS`         | A required parameter is missing or has the wrong type        |
| `-32603` | `INTERNAL_ERROR`         | Uncaught Python exception — `error.data.traceback` populated |
| `-32001` | `ATSPI_INIT_FAILED`      | `Atspi.init()` returned 2 OR PyGObject missing               |
| `-32002` | `ATSPI_NOT_FOUND`        | `nodeId` does not resolve in the current desktop snapshot    |
| `-32003` | `ATSPI_OPERATION_FAILED` | Underlying AT-SPI call raised `GLib.Error`                   |
| `-32004` | `WAYLAND_LIMITATION`     | Reserved for future Wayland-specific degrade signals         |
| `-32005` | `TIMEOUT`                | `wait_for` did not match within `timeoutMs`                  |

## Tests

```bash
sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core
pip install pytest
PYTHONPATH=. pytest tests/
```

The bridge module is import-safe on non-Linux (Windows + macOS) — the
`gi.repository.Atspi` import is guarded. Unit tests for `rpc.py` and
`wayland.py` therefore run on every CI matrix entry, but the AT-SPI
operations are exercised only on the `ubuntu-latest` runner.
