# Flutter Session Discovery Empirics — 2026-05-17

**Investigator:** worker-P  
**Environment:** Windows 11 Pro 10.0.26200, Flutter 3.41.9 (stable), Dart SDK 3.11.5, VS Code Dart-Code 3.134.0 (flutter-3.134.0), IntelliJ: NOT INSTALLED  
**Guinea pig:** a Flutter app (`lib/main_development.dart`)

---

## 1. Environment Audit

| Item                      | Value                       |
| ------------------------- | --------------------------- |
| OS                        | Windows 11 Pro 10.0.26200   |
| Flutter                   | 3.41.9 (stable, 2026-04-29) |
| Dart SDK                  | 3.11.5 (stable)             |
| DevTools                  | 2.54.2                      |
| VS Code Dart-Code         | 3.134.0                     |
| VS Code Flutter ext       | 3.134.0                     |
| IntelliJ / Android Studio | NOT INSTALLED               |

---

## 2. Terminal-Launched Session (Empirically Observed)

Two live `flutter run -d chrome` sessions were found already running on the machine at observation time. Session analysis is from those live processes — no new flutter run was spawned (ports were already in use at 4206; spawning would have required a different port).

### Process Tree (Session 1, flutter_tools.f19e916)

```
PID 83892  dart.exe  flutter_tools.snapshot run -d chrome -t lib/main_development.dart
             --web-port=4206
             --web-browser-flag=--headless=new
             --web-browser-flag=--disable-gpu
             --web-browser-flag=--no-sandbox
             --dart-define=env=tests

PID 72124  dartvm.exe   (the actual Dart VM running the app)
             --enable-vm-service=44456/127.0.0.1
             (inferred from: port 44456 owned by PID 72124)

PID 72328  dartaotruntime.exe  frontend_server_aot.dart.snapshot
             --sdk-root .../flutter_web_sdk/
             --packages .dart_tool/package_config.json
             --output-dill C:\...\flutter_tools.f19e916\flutter_tool.960a6eb6\app.dill
             (incremental compiler)

PID 53908  dartaotruntime.exe  dds_aot.dart.snapshot
             --vm-service-uri=http://127.0.0.1:44456/4hT1IFnQtjM=
             --bind-address=127.0.0.1
             --bind-port=0          ← port assigned dynamically
             --serve-devtools

PID 69232  chrome.exe  (headless)
             --user-data-dir=...\flutter_tools.f19e916\flutter_tools_chrome_device.9397ec92
             --remote-debugging-port=50550
             http://localhost:4206
```

### Key URIs (Session 1)

| Service             | URI                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Raw Dart VM service | `http://127.0.0.1:44456/4hT1IFnQtjM=`                                                        |
| DDS (multi-client)  | `ws://127.0.0.1:50639/VQKkdeOH2R8=/ws`                                                       |
| DDS devtools port   | `http://127.0.0.1:50638/` (requires token, returns "missing or invalid authentication code") |
| Chrome CDP          | `http://127.0.0.1:50550` (`--remote-debugging-port`)                                         |
| App web port        | `http://localhost:4206`                                                                      |

### VM → DDS redirection (CRITICAL empirical observation)

Attempting HTTP GET on the raw VM URI `http://127.0.0.1:44456/4hT1IFnQtjM=` returns:

```
Cannot connect directly to the VM service as a Dart Development Service (DDS) instance
has taken control and can be found at http://127.0.0.1:50639/VQKkdeOH2R8=/.
```

**Implication for process-scan discovery:** The raw VM port (44456) is always available in the process cmdline as `--enable-vm-service=<port>/<host>` on the `dartvm.exe` process. But connecting to it directly is rejected when DDS is running — the redirect response **gives you the DDS URI**. This is a reliable discovery mechanism: parse the redirect body to extract the real DDS URI.

### Ports Summary (Session 1)

| Port  | Owner PID       | Process            | Purpose                         |
| ----- | --------------- | ------------------ | ------------------------------- |
| 4206  | 72124 (dartvm)  | dartvm.exe         | App web server                  |
| 44456 | 72124 (dartvm)  | dartvm.exe         | Raw VM service (DDS takes over) |
| 50639 | 53908 (dds_aot) | dartaotruntime.exe | DDS multi-client WS endpoint    |
| 50638 | 53908 (dds_aot) | dartaotruntime.exe | DDS devtools endpoint           |
| 50550 | 69232 (chrome)  | chrome.exe         | Chrome CDP                      |

### DDS `--bind-port=0` → dynamic port assignment

The DDS process is always launched with `--bind-port=0`, meaning **the DDS port is always dynamic and cannot be predicted**. The port must be discovered from:

1. The redirect response from the raw VM port (most reliable)
2. Port scan + `getVM` probe
3. Process netstat join (DDS PID → LISTEN port)

### Temp dir layout for terminal-launched sessions

```
%TEMP%\flutter_tools.<random8hex>\
  flutter_tool.<random8hex>\
    app.dill          (compiled app)
    app.dill.json     (source map)
    app.dill.map
    app.dill.metadata
    app.dill.sources
    app.dill.incremental.dill
  flutter_tools.<random8hex>\
    web_entrypoint.dart
    web_plugin_registrant.dart
  flutter_tools_chrome_device.<random8hex>\
    Local State
    Last Browser
    Last Version
    (Chrome profile files — no session JSON here)
```

**No DTD info file written here.** No `*dtd*.json` found in any `flutter_tools.*` directory. The DTD info file mechanism (`--dtd-write-info-file`) is only used when the spawner (VS Code Dart-Code) passes that flag — terminal `flutter run` does NOT pass it.

### `.dart_tool/` directory (project-local)

Pre-existing content in the project's `.dart_tool/`:

```
.dart_tool/
  build/                  (build_runner artifacts)
  build_resolvers/
  chrome-device/          (EMPTY — not used by flutter run -d chrome)
  dartpad/                (EMPTY — not used locally)
  extension_discovery/
  flutter_build/
  hooks_runner/
  native_assets/
  pub/
  native_assets.yaml
  package_config.json     (dep resolution — critical for flutter run)
  package_graph.json
  version                 → "3.41.9"
```

**`chrome-device/` is empty.** No session info written there by flutter run.

**No dart_tool files at user home level:**

- `~/.dart_tool/` — NOT FOUND
- `~/.dart-tool/` — NOT FOUND
- `%TEMP%\dart_tool\` — NOT FOUND
- `%LOCALAPPDATA%\dart\` — only contains pub global install bundles (jaspr_cli etc.)
- `%APPDATA%\dart\` — only `pub-credentials.json` and `pub-tokens.json`

### Environment variables

No flutter/dart session env vars injected into terminal-launched processes:

- `DART_TOOL_DAEMON_URI` — NOT SET (in this terminal session)
- `FLUTTER_TOOL_LOG` — NOT SET
- `DART_VM_OPTIONS` — NOT SET

These are only injected by VS Code's Dart extension into its integrated terminals.

---

## 3. VS Code F5 Session — Dart-Code 3.134.0 Analysis

VS Code was **not running** at observation time, so no live VS Code session could be captured. The following is derived from static analysis of the Dart-Code 3.134.0 extension bundle (`out/dist/extension.js`).

### What Dart-Code does when you press F5

1. Launches `flutter run --machine` as a child process via the Dart Debug Adapter (DAP).
2. Listens for the `dart.debuggerUris` DAP event from the debug adapter, which carries:
   - `body.vmServiceUri` — the DDS URI (already DDS-proxied, not raw VM)
   - `body.clientVmServiceUri` — exposed URI for remote scenarios
   - `body.observatoryUri` — legacy alias
3. Stores these on the `DartDebugSession` object.
4. Fires `onDebugSessionVmServiceAvailableEmitter` — this is the signal that a VM service is ready.

### DTD (Dart Tooling Daemon) — the critical VS Code mechanism

Dart-Code 3.134.0 spawns its **own DTD** process:

```
dart.exe tooling-daemon --machine [additionalArgs]
```

The DTD prints one JSON line to stdout on startup:

```json
{
  "tooling_daemon_details": {
    "uri": "ws://127.0.0.1:<port>/...",
    "trusted_client_secret": "<secret>"
  }
}
```

Dart-Code reads this via `DartToolingDaemonProcess.processUnhandledMessage()` and resolves `dtdUriCompleter` with the URI. **This URI is never written to a file on disk by Dart-Code itself** — it lives only in memory in the extension host.

### What Dart-Code registers on the DTD

Once the DTD is running, Dart-Code registers these JSON-RPC services on it:

| DTD Method                               | What it does                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ConnectedApp.registerVmService`         | Called when a debug session's VM service becomes available — registers `{uri, name, exposedUri}`                                      |
| `ConnectedApp.unregisterVmService`       | Called when debug session stops                                                                                                       |
| `ConnectedApp.getVmServices`             | **QUERYABLE** — returns all currently registered VM services                                                                          |
| `Editor.getDebugSessions`                | Returns all active debug sessions with shape: `{id, name, debuggerType, flutterDeviceId, flutterMode, projectRootPath, vmServiceUri}` |
| `Editor.getActiveLocation`               | Current cursor location                                                                                                               |
| `Editor.hotReload` / `Editor.hotRestart` | Trigger reload on a session by `debugSessionId`                                                                                       |

### `Editor.getDebugSessions` response shape

```json
{
  "type": "GetDebugSessionsResult",
  "debugSessions": [
    {
      "id": "<vscode-debug-session-id>",
      "name": "Launch development",
      "debuggerType": "Flutter",
      "flutterDeviceId": "chrome",
      "flutterMode": "debug",
      "projectRootPath": "D:\\projects\\my-flutter-app",
      "vmServiceUri": "ws://127.0.0.1:<dds-port>/<token>/ws"
    }
  ]
}
```

### `dart.getActiveSessions` — DEBUNKED

The plan §7.1 mentioned `dart.getActiveSessions` as a VS Code LSP custom method. **This does not exist in Dart-Code 3.134.0.** Grep of the entire extension bundle found zero matches. The correct API is `Editor.getDebugSessions` called via DTD JSON-RPC, not via LSP.

### How to access the DTD URI from an external tool

**Problem:** The DTD URI is only in the extension host's memory. Dart-Code does not write it to a file.

**Known workaround (observed in Dart-Code source):** The extension exposes a public API via `vscode.extensions.getExtension('Dart-Code.dart-code').exports`:

- `exports.dtdUri` — `Promise<string | undefined>` — resolves to the DTD URI when available
- `exports.onDtdUriChanged` — VS Code event emitter

This requires being a VS Code extension to call. An external MCP server cannot use this directly.

**Alternative:** The `DART_TOOL_DAEMON_URI` env var. Dart-Code injects this into terminals it opens (via VS Code's terminal environment variable injection API). An MCP server that is launched from such a terminal would inherit this. However:

- It is NOT set in terminals opened outside VS Code
- It is NOT set in processes launched by the MCP server itself unless the MCP server inherits it

**Process-scan fallback is most reliable for external tools** — dart tooling-daemon process will appear as `dart.exe tooling-daemon --machine` and its WS port is discoverable via netstat.

### `.dart_code_tooling.json` — NOT FOUND

The plan mentioned `.vscode/.dart_code_tooling.json` as a possible file written by Dart-Code. This file does **not exist** in:

- `<project>/.vscode/`
- `D:\projects\devops-aggregate\.vscode\`
- `%APPDATA%\Code\`

After static analysis of Dart-Code 3.134.0: no code writes such a file. **The assumption was fabricated.** Dart-Code does not write a tooling JSON file to disk.

### `DART_TOOL_DAEMON_URI` env var injection (not a file, an env var)

Dart-Code 3.134.0 injects `DART_TOOL_DAEMON_URI` into VS Code integrated terminals via `vscode.workspace.onDidOpenTerminal` + terminal environment variable injection. This is the primary mechanism for cooperating tools (like dart pub global executables) running inside VS Code terminals. External tools not launched from a VS Code terminal don't get this.

---

## 4. IntelliJ / Android Studio

**NOT INSTALLED** on this machine (Windows). Neither `%APPDATA%\JetBrains\` nor `%LOCALAPPDATA%\JetBrains\` exists. The IntelliJ Flutter plugin's session discovery mechanism is **UNVERIFIED — flagged for follow-up by Worker H in wave 3.**

---

## 5. Cross-OS Notes (UNVERIFIED — not empirically tested)

| Path                | macOS (unverified)                    | Linux (unverified)              |
| ------------------- | ------------------------------------- | ------------------------------- |
| VS Code user data   | `~/Library/Application Support/Code/` | `~/.config/Code/`               |
| VS Code extensions  | `~/.vscode/extensions/`               | `~/.vscode/extensions/`         |
| Pub cache global    | `~/.pub-cache/global_packages/`       | `~/.pub-cache/global_packages/` |
| Flutter temp dir    | `/tmp/flutter_tools.<hex>/`           | `/tmp/flutter_tools.<hex>/`     |
| DTD tooling env var | `DART_TOOL_DAEMON_URI` (same)         | `DART_TOOL_DAEMON_URI` (same)   |

Port mechanics and process structure are the same across OSes — DDS always uses `--bind-port=0` dynamic assignment, raw VM port 44456 redirect trick works identically.

---

## 6. What's Actually Findable on Disk

| Artifact                       | Path                                                     | Available?                    | Notes                                                        |
| ------------------------------ | -------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| Raw VM port                    | `dartvm.exe --enable-vm-service=<port>` cmdline          | YES (via process scan)        | PID → port via WMI/netstat                                   |
| DDS URI                        | HTTP GET raw VM port → redirect body                     | YES (probe raw port)          | Returns `http://127.0.0.1:<dds-port>/<token>=`               |
| DDS WS URI                     | `ws://127.0.0.1:<dds-port>/<token>=/ws`                  | YES (construct from redirect) | Just append `/ws`                                            |
| Chrome CDP port                | `chrome.exe --remote-debugging-port=<port>` cmdline      | YES (via process scan)        | Match by `--user-data-dir=...\flutter_tools_chrome_device.*` |
| Compiled app dill              | `%TEMP%\flutter_tools.<hex>\flutter_tool.<hex>\app.dill` | YES                           | Only useful for debugging                                    |
| DTD URI (VS Code)              | Memory-only in extension host                            | NO (from external process)    | Use process scan for `dart.exe tooling-daemon` instead       |
| Session registry file          | Any `*session*.json`, `*dtd*.json`                       | NO                            | Does not exist                                               |
| `~/.dart-tool/...` (plan §7.1) | `~/.dart-tool/dart-services/dtd-info.json` etc.          | NO — DEBUNKED                 | Fabricated paths, confirmed absent                           |
| `.dart_code_tooling.json`      | `.vscode/.dart_code_tooling.json`                        | NO — DEBUNKED                 | Not written by Dart-Code 3.134.0                             |

---

## 7. What's NOT Findable (Debunking Plan Assumptions)

These paths were referenced in earlier plan drafts and are now empirically confirmed as non-existent:

| Claimed path                                        | Status                                                        |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `~/.dart-tool/dart-services/dtd-info.json`          | NOT FOUND — directory doesn't exist                           |
| `~/.dart-tool/dart-code/active-sessions.json`       | NOT FOUND — directory doesn't exist                           |
| `~/.dart_tool/` (user home)                         | NOT FOUND                                                     |
| `<project>/.dart_tool/dartpad/info.json`            | NOT FOUND — `.dart_tool/dartpad/` is EMPTY                    |
| `<project>/.dart_tool/chrome-device/<session>.json` | NOT FOUND — chrome-device/ is EMPTY                           |
| `.vscode/.dart_code_tooling.json`                   | NOT FOUND — Dart-Code 3.134.0 never writes this               |
| `dart.getActiveSessions` (LSP method)               | NOT FOUND in Dart-Code 3.134.0 source                         |
| Port range "8181-8200" for VM service               | DEBUNKED — observed port 44456; DDS on 50639. No fixed range. |

---

## 8. Recommended Discovery Ladder (Concrete Sequence, Windows-First)

Based on empirical observation:

### Strategy S1: CLI arg `--vm-uri` (explicit)

User passes URI directly. Return immediately. Most reliable.

### Strategy S2: Process scan + raw VM port redirect trick (BEST FALLBACK)

```typescript
// Step 1: Find dartvm.exe processes with --enable-vm-service in cmdline
// Windows: WMI Win32_Process query
// macOS/Linux: ps aux | grep 'enable-vm-service'
const dartVmProcs = await getProcessesWithCmdlineMatch(/--enable-vm-service=(\d+)/);

// Step 2: For each, extract raw VM port from cmdline flag
for (const proc of dartVmProcs) {
  const port = proc.cmdline.match(/--enable-vm-service=(\d+)/)?.[1];

  // Step 3: HTTP GET the raw VM port — DDS redirect gives us the real URI
  const resp = await fetch(`http://127.0.0.1:${port}/${token}/`);
  // Response body (even on "error") contains:
  // "Cannot connect directly ... DDS at http://127.0.0.1:<dds-port>/<dds-token>=/"
  const ddsUri = extractDdsUriFromRedirectBody(resp.body);

  // Step 4: Construct WS URI: http → ws, append /ws
  const wsUri = ddsUri.replace('http://', 'ws://').replace(/\/?$/, '/ws');

  // Step 5: Verify with getVM RPC
  const vm = await vmServiceCall(wsUri, 'getVM');
  if (vm) yield { uri: wsUri, source: 'process-scan', pid: proc.pid };
}
```

**Token extraction from cmdline:** The raw VM URI token (`4hT1IFnQtjM=`) appears in the `dds_aot` process cmdline as `--vm-service-uri=http://127.0.0.1:<port>/<token>=`. It's also in the redirect response body. So you can get the full URI from either the `dds_aot` cmdline or the redirect response.

### Strategy S3: DTD query via `ConnectedApp.getVmServices` (VS Code sessions)

When VS Code is running with Dart-Code:

1. Find `dart.exe tooling-daemon --machine` process (distinct from `dartvm.exe`)
2. Get its WS port via `Get-NetTCPConnection` (single listening port)
3. Connect WS to `ws://127.0.0.1:<dtd-port>/`
4. Send JSON-RPC: `{"jsonrpc":"2.0","id":1,"method":"ConnectedApp.getVmServices","params":{"secret":"<trusted_client_secret>"}}`
5. Returns list of registered VM service URIs

**Problem:** `trusted_client_secret` is required. It's only printed once to DTD's stdout at startup, captured by Dart-Code extension host. External tools cannot get it from disk.

**Alternative — `Editor.getDebugSessions`:** Same DTD WS, but this method may not require the secret (needs verification). Returns `vmServiceUri` per session. Worth trying without secret first.

### Strategy S4: `DART_TOOL_DAEMON_URI` env var

If the MCP server process inherits `DART_TOOL_DAEMON_URI` from a VS Code terminal:

```typescript
const dtdUri = process.env.DART_TOOL_DAEMON_URI;
if (dtdUri) {
  /* connect to DTD, call Editor.getDebugSessions */
}
```

Only works for MCP servers launched from VS Code integrated terminal.

### Strategy S5: MCP-spawned `flutter run --machine` stdout parse (most reliable for lifecycle-owned sessions)

```typescript
// flutter run --machine emits machine-mode JSON events:
// {"event":"app.started","params":{"appId":"...","vmServiceUri":"ws://...","...":...}}
const proc = spawn('flutter', ['run', '--machine', '-d', 'chrome', ...]);
proc.stdout.on('data', (chunk) => {
  for (const line of chunk.toString().split('\n')) {
    const json = tryParse(line);
    if (json?.event === 'app.started') {
      yield { uri: json.params.vmServiceUri, source: 'machine-stdout' };
    }
  }
});
```

### Strategy S6: Return empty + user help

```
No sessions found. Either:
1. Pass --vm-uri <ws://...> explicitly
2. Run launch_app to have flutter-ultra own the lifecycle
3. Start flutter run with: flutter run -d chrome --enable-vm-service
```

---

## 9. Chrome CDP Discovery (Bonus)

For tools that need Chrome CDP (playwright-equivalent):

```powershell
# Find Chrome processes launched by flutter_tools (not the user's regular Chrome)
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'chrome.exe' -and
  $_.CommandLine -match 'flutter_tools_chrome_device' -and
  $_.CommandLine -match '--remote-debugging-port=(\d+)'
} | ForEach-Object {
  $port = [regex]::Match($_.CommandLine, '--remote-debugging-port=(\d+)').Groups[1].Value
  "CDP at http://localhost:$port"
}
```

The `--user-data-dir` path contains `flutter_tools_chrome_device` as a discriminator — use this to distinguish flutter-launched Chrome from the user's regular Chrome browser.

---

## 10. Cleanup

No new `flutter run` processes were spawned during this investigation. The two pre-existing sessions (PIDs 83892/69232 and stale 66812 Chrome) were not killed — they belong to the user's ongoing work session. The `dds_aot` process (PID 53908) and `dartvm` (PID 72124) were observed but not modified.
