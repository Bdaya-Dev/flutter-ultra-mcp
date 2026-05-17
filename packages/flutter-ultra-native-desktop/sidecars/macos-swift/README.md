# flutter-ultra-mac-helper

Swift sidecar binary for the `flutter-ultra-native-desktop` MCP server.

Drives macOS native UIs via the Accessibility (AX) APIs and CoreGraphics
event synthesis, talking JSON-RPC 2.0 over stdin/stdout.

## Build

```sh
swift build -c release
# binary at .build/release/flutter-ultra-mac-helper
```

CI's `macos-latest` matrix job builds + copies to `bin/`:

```sh
swift build -c release
mkdir -p bin
cp .build/release/flutter-ultra-mac-helper bin/flutter-ultra-mac-helper
codesign --force --options runtime --sign "Developer ID Application: <team>" bin/flutter-ultra-mac-helper
xcrun notarytool submit bin/flutter-ultra-mac-helper.zip --apple-id … --wait
```

## TCC permissioning

The AX APIs gate every read/write on `AXIsProcessTrusted()`. There is **no
programmatic grant**:

1. Open → System Settings → Privacy & Security → Accessibility
2. Click '+' and add `flutter-ultra-mac-helper`
3. Toggle the switch ON
4. Re-run the host tool

The helper exposes `AXIsProcessTrusted()` through the `hello` RPC so the
MCP server can detect denial and surface the user-facing remediation
message before attempting any AX call.

## Protocol

Newline-delimited JSON-RPC 2.0 frames on stdin/stdout.

| Method               | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `hello`              | Handshake; returns version + AX trust status + bundle id.                     |
| `listWindows`        | Enumerate top-level windows visible to AX.                                    |
| `dumpWindowTree`     | Walk the AX hierarchy under a window.                                         |
| `desktopQuery`       | XPath-style query subset over the AX tree.                                    |
| `desktopClick`       | Click by element id or absolute coords; synthesizes via CGEvent.              |
| `desktopType`        | Type into focused widget; optional element-focus first; optional clear-first. |
| `desktopScreenshot`  | CGWindowListCreateImage of a window or screen, returned as base64 PNG.        |
| `selectFileInDialog` | Type a path into a file dialog and click the confirm button.                  |
| `confirmDialog`      | Click a localized intent button in the frontmost modal.                       |
| `waitForWindow`      | Poll for a window matching titlePattern / processName.                        |
| `shutdown`           | Notification — graceful exit.                                                 |

Error codes mirror `Errors.swift`:

| Code   | Constant                    | Meaning                                                         |
| ------ | --------------------------- | --------------------------------------------------------------- |
| -32000 | `MAC_ERR_TCC_NOT_GRANTED`   | `AXIsProcessTrusted() == false`.                                |
| -32001 | `MAC_ERR_WINDOW_NOT_FOUND`  | The window id refers to a closed / unknown window.              |
| -32002 | `MAC_ERR_ELEMENT_NOT_FOUND` | The element id refers to a stale / unknown a11y handle.         |
| -32003 | `MAC_ERR_AX_FAILURE`        | `AXUIElementCopy…` returned a non-success error.                |
| -32004 | `MAC_ERR_DIALOG_TIMEOUT`    | Dialog detection / button search exceeded the per-call timeout. |
