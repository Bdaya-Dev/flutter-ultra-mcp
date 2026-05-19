---
name: flutter-devtools
description: Wiring up and using the flutter-ultra DevTools panel to inspect live MCP activity, attached sessions, and agent tool calls from inside the IDE. Use when the user wants to see the plugin's activity timeline, pause/resume agent flows from the panel, or stream screenshots to the DevTools view.
---

# flutter-devtools — Wire Up the DevTools Panel

## When to use

Use this skill when the user wants to:
- See live MCP tool call activity inside Flutter DevTools while the agent is running.
- Pause or resume an automated agent flow from a panel button (human-in-the-loop).
- Stream screenshots or session events to the DevTools view during a tour or drive flow.
- Verify that the DevTools extension is correctly wired to the running MCP server.

## Prerequisites

- The flutter-ultra-mcp plugin is already set up in the project (run `/flutter-setup` first if not).
- Flutter DevTools is open in the IDE (VS Code: `Dart: Open DevTools` from the command palette; Android Studio: via the Flutter Inspector toolbar).
- The DevTools extension tab labeled **flutter-ultra** must be visible. If it is not, the `ultra_flutter_devtools` package may not be in `dev_dependencies` — step 1 covers this.

## Workflow

### 1. Ensure `ultra_flutter_devtools` is in dev_dependencies

- Call `mcp__plugin_flutter_flutter-ultra-build__project_info` to read existing dependencies.
- If `ultra_flutter_devtools` is NOT listed under `dev_dependencies`:
  - Call `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `package: ultra_flutter_devtools`, `dev: true`.
  - Call `mcp__plugin_flutter_flutter-ultra-build__pub_get` to resolve.
- If `pub_add` fails (package not on pub.dev — it is bundled with the MCP plugin):
  - Call `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_set` with the bundled package path.
  - Add `ultra_flutter_devtools: any` manually under `dev_dependencies` in `pubspec.yaml`.
  - Call `mcp__plugin_flutter_flutter-ultra-build__pub_get`.

### 2. Start the panel WebSocket server

- Call `mcp__plugin_flutter_flutter-ultra-devtools__start_panel_server` with `port: 9170` (default).
  - Returns: `{ url: "ws://127.0.0.1:9170", port: 9170, status: "listening" }`.
  - If the port is already in use, retry with `port: 9171` (or any free port above 9170).
- Note the returned `url` — this is what the DevTools extension iframe connects to.

### 3. Connect the DevTools extension

- Open Flutter DevTools in the IDE and navigate to the **flutter-ultra** tab.
- The extension panel auto-connects to `ws://127.0.0.1:9170` when the tab loads (default port).
- Verify connection by calling `mcp__plugin_flutter_flutter-ultra-devtools__panel_status`:
  - Expect: `{ running: true, viewers: 1, url: "ws://127.0.0.1:9170" }`.
  - If `viewers: 0` after 10 seconds, the extension has not connected — see edge cases below.

### 4. Push a test event to confirm the pipeline

- Call `mcp__plugin_flutter_flutter-ultra-devtools__push_event` with:
  - `type: "custom"`
  - `server: "flutter-ultra-devtools"`
  - `payload: { message: "flutter-ultra panel connected" }`
- If `delivered: 1` is returned, the panel is receiving events. The user should see the notification in the DevTools flutter-ultra tab.

### 5. Stream activity during automated flows (optional)

During long operations (tour, drive, patrol test runs), push events to keep the panel updated:

- After each screenshot: call `push_event` with `type: "screenshot"` and `payload: { path: "<screenshot-path>", route: "<current-route>" }`.
- After each tool call completes: call `push_event` with `type: "tool_result"` and `payload: { tool: "<tool-name>", status: "ok" }`.
- On error: call `push_event` with `type: "error"` and `payload: { message: "<error>" }`.

This is especially useful when running `/flutter-tour` or `/flutter-drive` so the user can follow progress without reading the raw agent output.

### 6. Wait for human-in-the-loop panel commands (optional)

To pause an automated flow and wait for the panel user to click a button:

- Call `mcp__plugin_flutter_flutter-ultra-devtools__panel_command` with:
  - `timeoutMs: 300000` (5 minutes — adjust to the expected review window)
  - `prompt: "Review the current state and click Resume when ready."`
- The tool blocks until the panel user sends a command or the timeout expires.
- Returns: `{ type: "resume" | "pause" | <custom>, payload: {...}, viewerId: "...", timestamp: "..." }`.
- Use `type === "pause"` to abort the current flow; `type === "resume"` to continue.

### 7. Stop the server when done

- Call `mcp__plugin_flutter_flutter-ultra-devtools__stop_panel_server` when the session ends.
  - This disconnects all panel viewers and frees the port.
  - Safe to call even if no viewers are connected.

## Handling edge cases

- **`viewers: 0` after tab load**: the DevTools extension connects to port 9170 by default. If `start_panel_server` used a different port, the extension won't find it. Either restart with port 9170, or check if the extension allows a custom port in its settings panel.
- **Port already in use**: `start_panel_server` will throw. Call `panel_status` first — if `running: true` and the port matches, the server is already up from a previous session; skip to step 3.
- **`pub_add ultra_flutter_devtools` fails**: the package is bundled inside the MCP plugin distribution. Ask the user for the plugin root path and use `pubspec_overrides_set` to point to `<plugin-root>/packages/flutter-ultra-devtools/dart/`.
- **DevTools tab not visible**: the `ultra_flutter_devtools` package must be imported somewhere in the app (it self-registers its DevTools extension on import). Add `import 'package:ultra_flutter_devtools/ultra_flutter_devtools.dart';` to the entry point or a debug-only file.
- **`panel_command` times out**: the panel user did not interact within `timeoutMs`. Treat the timeout as a "continue" signal and proceed with the automated flow. Notify the user in your response that the timeout elapsed.
- **Multiple IDEs / DevTools windows**: each opened DevTools flutter-ultra tab creates a separate viewer. `push_event` broadcasts to all of them. `panel_command` dequeues from the first one that sends a response — subsequent responses from other viewers are discarded.

## Output format

After completing setup, report:

1. **Panel URL**: the WebSocket URL the extension connects to.
2. **Viewer count**: how many DevTools windows are connected.
3. **Test event delivered**: yes/no.
4. **Next steps**: suggest running `/flutter-tour` or `/flutter-drive` with the panel open to see live event streaming.

## Example

```
User: "Wire up the DevTools panel so I can see what the agent is doing."

1. project_info → ultra_flutter_devtools not in dev_dependencies
2. pub_add ultra_flutter_devtools dev:true → added
3. pub_get → resolved
4. start_panel_server port:9170 → url: ws://127.0.0.1:9170
5. [User opens DevTools → flutter-ultra tab]
6. panel_status → { running: true, viewers: 1 }
7. push_event type:custom payload:{ message: "flutter-ultra panel connected" }
   → delivered: 1
8. Panel confirmed working.

Panel URL: ws://127.0.0.1:9170 — 1 viewer connected.
Test event delivered: yes.
Next: run /flutter-tour with the panel open to see screenshots streaming live.
```

## See also

- Sibling skill: `flutter-tour` — route screenshot tour; push screenshot events during the tour
- Sibling skill: `flutter-drive` — multi-step flows; use `panel_command` for human review gates
- `mcp__plugin_flutter_flutter-ultra-devtools__start_panel_server` — start the WS server
- `mcp__plugin_flutter_flutter-ultra-devtools__panel_status` — check viewer count
- `mcp__plugin_flutter_flutter-ultra-devtools__push_event` — stream events to the panel
- `mcp__plugin_flutter_flutter-ultra-devtools__panel_command` — wait for human-in-the-loop input
