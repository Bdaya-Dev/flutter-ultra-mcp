---
name: flutter-devtools
description: Wires up and uses the flutter-ultra DevTools panel to inspect live MCP activity, pause/resume agent flows, and stream screenshots to the DevTools view. Use when the user wants to see plugin activity in DevTools, set up human-in-the-loop review gates, or stream live progress from tours and drive flows.
---

# DevTools Panel Integration

## Workflow

### 1. Ensure `ultra_flutter_devtools` is in dev_dependencies

- `mcp__plugin_flutter_flutter-ultra-build__project_info` to check existing dependencies.
- If missing: `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `ultra_flutter_devtools`, `dev: true`.
- If `pub_add` fails (bundled package): `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_set` with the bundled path, then `mcp__plugin_flutter_flutter-ultra-build__pub_get`.

### 2. Start the panel server

- `mcp__plugin_flutter_flutter-ultra-devtools__start_panel_server` with `port: 9170`.
- Returns `{ url, port, status }`.
- If port is in use, call `mcp__plugin_flutter_flutter-ultra-devtools__panel_status` first — if already running, skip to step 3.

### 3. Verify connection

- Open Flutter DevTools in the IDE, navigate to the **flutter-ultra** tab.
- `mcp__plugin_flutter_flutter-ultra-devtools__panel_status` — expect `{ running: true, viewers: 1 }`.

### 4. Test the pipeline

- `mcp__plugin_flutter_flutter-ultra-devtools__push_event` with:
  - `type: "custom"`, `server: "flutter-ultra-devtools"`, `payload: { message: "panel connected" }`.
- If `delivered: 1`, the panel is receiving events.

### 5. Stream activity during automated flows

Push events to keep the panel updated during `/flutter:tour` or `/flutter:drive`:

**Screenshot events:**

```
push_event(type: "screenshot", payload: { path: "tour/login.png", route: "/login" })
```

**Tool result events:**

```
push_event(type: "tool_result", payload: { tool: "tap", status: "ok" })
```

**Error events:**

```
push_event(type: "error", payload: { message: "Widget not found" })
```

Combine with tools from other servers for rich context:

- After `mcp__plugin_flutter_flutter-ultra-runtime__screenshot`, push the path as a screenshot event.
- After `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors`, push errors as error events.
- After `mcp__plugin_flutter_flutter-ultra-gesture__tap`, push the result as a tool_result event.
- After `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_result`, push test results.

### 6. Human-in-the-loop review gates

To pause and wait for the panel user to click Resume:

- `mcp__plugin_flutter_flutter-ultra-devtools__panel_command` with `timeoutMs` and `prompt`.
- Returns `{ type: "resume" | "pause" | <custom>, payload, viewerId, timestamp }`.
- `type === "pause"` means abort; `type === "resume"` means continue.

Useful during:

- Long `flutter-tour` runs — let the user review each route before continuing.
- `flutter-drive` validation flows — gate critical steps behind human approval.
- `flutter-test` patrol runs — pause after failures for manual inspection.

### 7. Stop the server

- `mcp__plugin_flutter_flutter-ultra-devtools__stop_panel_server` when the session ends.

## Edge cases

- **`viewers: 0` after tab load**: the DevTools extension connects to port 9170 by default. If a different port was used, restart with 9170.
- **Port already in use**: `mcp__plugin_flutter_flutter-ultra-devtools__panel_status` first — if running, reuse it.
- **DevTools tab not visible**: `ultra_flutter_devtools` must be imported somewhere in the app (self-registers on import).
- **`panel_command` times out**: treat as "continue" and proceed. Notify the user.
- **Multiple DevTools windows**: `push_event` broadcasts to all. `panel_command` dequeues from the first responder.

## Tool reference

| Action           | Tool                                                             |
| ---------------- | ---------------------------------------------------------------- |
| Start server     | `mcp__plugin_flutter_flutter-ultra-devtools__start_panel_server` |
| Stop server      | `mcp__plugin_flutter_flutter-ultra-devtools__stop_panel_server`  |
| Check status     | `mcp__plugin_flutter_flutter-ultra-devtools__panel_status`       |
| Push event       | `mcp__plugin_flutter_flutter-ultra-devtools__push_event`         |
| Wait for command | `mcp__plugin_flutter_flutter-ultra-devtools__panel_command`      |
| Dump diagnostics | `mcp__plugin_flutter_flutter-ultra-devtools__dump_diagnostics`   |
| Project info     | `mcp__plugin_flutter_flutter-ultra-build__project_info`          |
| Add dependency   | `mcp__plugin_flutter_flutter-ultra-build__pub_add`               |
| Resolve deps     | `mcp__plugin_flutter_flutter-ultra-build__pub_get`               |
| Overrides set    | `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_set` |
| VM screenshot    | `mcp__plugin_flutter_flutter-ultra-runtime__screenshot`          |
| Runtime errors   | `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors`  |
| Gesture tap      | `mcp__plugin_flutter_flutter-ultra-gesture__tap`                 |
| Patrol result    | `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_result`    |

## Event types reference

| Type          | Payload                                          | When to use                        |
| ------------- | ------------------------------------------------ | ---------------------------------- |
| `custom`      | `{ message: string }`                            | General notifications              |
| `screenshot`  | `{ path: string, route?: string }`               | After capturing a screenshot       |
| `tool_result` | `{ tool: string, status: string }`               | After any tool call completes      |
| `error`       | `{ message: string, stack?: string }`            | On runtime errors or tool failures |
| `progress`    | `{ step: number, total: number, label: string }` | During multi-step flows            |
| `test_result` | `{ name: string, passed: boolean }`              | After each test completes          |

## Example

```
User: "Wire up the DevTools panel."

1. project_info -> ultra_flutter_devtools not in dev_dependencies
2. pub_add ultra_flutter_devtools dev:true
3. pub_get
4. start_panel_server(port: 9170) -> ws://127.0.0.1:9170
5. [User opens DevTools -> flutter-ultra tab]
6. panel_status -> { running: true, viewers: 1 }
7. push_event(type: "custom", payload: { message: "panel connected" }) -> delivered: 1
-> "Panel at ws://127.0.0.1:9170, 1 viewer connected."
```

## See also

- `flutter-tour` — route screenshot tour; push screenshot events during the tour
- `flutter-drive` — multi-step flows; use `panel_command` for human review gates
- `flutter-test` — test orchestration; push test results to the panel
