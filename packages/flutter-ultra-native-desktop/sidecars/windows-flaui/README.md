# FlaUI Windows Sidecar (`flutter-ultra-win-helper`)

.NET 8 self-contained console executable that drives Windows UI Automation via
[FlaUI.UIA3](https://github.com/FlaUI/FlaUI) and exposes the Plan §5.6 desktop tool
surface over newline-delimited JSON-RPC 2.0 on stdin/stdout.

Consumed by `src/backends/windows.ts` (`WindowsDesktopBackend`).

## Build

Requires .NET 8 SDK on the build host.

```powershell
npm --workspace @flutter-ultra/flutter-ultra-native-desktop run build:sidecar:windows
```

Outputs `flutter-ultra-win-helper.exe` to `sidecars/windows-flaui/bin/`.

CI matrix at `.github/workflows/sidecar-windows.yml` builds `win-x64` + `win-arm64`
prebuilds on `windows-latest` and uploads them as release artifacts (plan §22).

## Tools

| Method | Plan §5.6 tool |
|---|---|
| `hello` | handshake — returns `{version, uiaInitialized}` |
| `listWindows` | `list_windows` — enumerate top-level windows |
| `dumpWindowTree` | `dump_window_tree` — a11y tree for a window |
| `desktopQuery` | `desktop_query` — XPath-style query |
| `desktopClick` | `desktop_click` — click element/coords |
| `desktopType` | `desktop_type` — type text into focused element |
| `desktopScreenshot` | `desktop_screenshot` — PNG of window or screen |
| `selectFileInDialog` | `select_file_in_dialog` — drives Win32 #32770 (AC-ND1) |
| `confirmDialog` | `confirm_dialog` — intent → button mapper |
| `waitForWindow` | `wait_for_window` — poll by title/process |
| `shutdown` | notification — closes the RPC channel |

Unlike macOS, Windows UI Automation needs no runtime permission grant — `uiaInitialized`
is always true once the COM init succeeds.
