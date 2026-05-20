---
name: flutter-drive
description: Drives multi-step user flows in a running Flutter app via gestures and assertions. Use when reproducing a bug across several screens, validating an onboarding flow, running an ad-hoc end-to-end scenario without writing a patrol test, or automating login/checkout/form-submission sequences.
---

# Multi-Step User Flow Automation

Drive interactive flows step by step — login sequences, checkout funnels, onboarding wizards, form submissions — verifying state and capturing screenshots between major steps. For repeatable E2E test suites, use `flutter-test` instead.

## Workflow

### 1. Attach to the running session

- `mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions` to find active sessions.
- If none, `mcp__plugin_flutter_flutter-ultra-runtime__launch_app` + `mcp__plugin_flutter_flutter-ultra-runtime__poll_launch_app`.
- `mcp__plugin_flutter_flutter-ultra-runtime__attach` with the chosen session.
- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` to confirm starting state.

### 2. Plan the flow

Break the user's request into discrete, verifiable steps. Announce the plan before executing if more than 3 steps.

### 3. For each step: inspect, act, verify, screenshot

**Inspect the current UI:**

- `mcp__plugin_flutter_flutter-ultra-runtime__find_widget` to confirm the target element exists.
- `mcp__plugin_flutter_flutter-ultra-gesture__interactive_elements` to discover all tappable/editable elements on screen.
- If not found, `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` to understand the hierarchy.

**Perform the action:**

| Action                    | Tool                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| Tap by key/text/coords    | `mcp__plugin_flutter_flutter-ultra-gesture__tap`                  |
| Double tap                | `mcp__plugin_flutter_flutter-ultra-gesture__double_tap`           |
| Long press                | `mcp__plugin_flutter_flutter-ultra-gesture__long_press`           |
| Enter text                | `mcp__plugin_flutter_flutter-ultra-gesture__enter_text`           |
| Clear text field          | `mcp__plugin_flutter_flutter-ultra-gesture__clear_text`           |
| Scroll to element         | `mcp__plugin_flutter_flutter-ultra-gesture__scroll_to`            |
| Scroll until visible      | `mcp__plugin_flutter_flutter-ultra-gesture__scroll_until_visible` |
| Swipe gesture             | `mcp__plugin_flutter_flutter-ultra-gesture__swipe`                |
| Pinch zoom                | `mcp__plugin_flutter_flutter-ultra-gesture__pinch_zoom`           |
| Navigate programmatically | `mcp__plugin_flutter_flutter-ultra-runtime__evaluate`             |

**Wait for the UI to settle:**

- `mcp__plugin_flutter_flutter-ultra-gesture__wait_for` to wait for a widget to appear/disappear after an action.
- Or `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` with `SchedulerBinding.instance.endOfFrame`.

**Verify the result:**

- `mcp__plugin_flutter_flutter-ultra-runtime__find_widget` for an expected element on the next screen.
- `mcp__plugin_flutter_flutter-ultra-runtime__widget_exists` for quick existence checks.
- `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to read state: `MyBloc.of(context).state.runtimeType`.
- On failure: `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` and `mcp__plugin_flutter_flutter-ultra-runtime__get_logs`.

**Screenshot after major transitions:**

- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` for VM-level capture.

### 4. HTTP/gRPC verification (optional)

Capture network traffic during the flow to verify API calls:

- `mcp__plugin_flutter_flutter-ultra-runtime__start_http_capture` before starting the flow.
- `mcp__plugin_flutter_flutter-ultra-runtime__get_http_events` at checkpoints to verify expected API calls were made.
- `mcp__plugin_flutter_flutter-ultra-runtime__decode_grpc_message` to inspect gRPC request/response payloads.
- `mcp__plugin_flutter_flutter-ultra-runtime__stop_http_capture` when done.

### 5. Web OAuth / external popups (web targets)

When a flow involves an external OAuth consent screen:

1. `mcp__plugin_flutter_flutter-ultra-browser__intercept_redirect` to capture the redirect URL.
2. `mcp__plugin_flutter_flutter-ultra-browser__navigate` to drive the external auth page.
3. `mcp__plugin_flutter_flutter-ultra-browser__fill` for username/password fields.
4. `mcp__plugin_flutter_flutter-ultra-browser__click` on the submit button.
5. `mcp__plugin_flutter_flutter-ultra-browser__wait_for_url` matching the app's redirect URI.

### 6. Native mobile system dialogs (mobile targets)

- `mcp__plugin_flutter_flutter-ultra-native-mobile__wait_for_native_element` to detect OS dialogs.
- `mcp__plugin_flutter_flutter-ultra-native-mobile__native_permission_grant` or `mcp__plugin_flutter_flutter-ultra-native-mobile__native_permission_deny`.
- `mcp__plugin_flutter_flutter-ultra-native-mobile__native_tap` for other system UI elements.
- `mcp__plugin_flutter_flutter-ultra-native-mobile__native_back` for Android back navigation.
- `mcp__plugin_flutter_flutter-ultra-native-mobile__native_home` to press Home.
- `mcp__plugin_flutter_flutter-ultra-native-mobile__solve_oauth_cct` for Chrome Custom Tab OAuth flows.

### 7. Native desktop dialogs (desktop targets)

- `mcp__plugin_flutter_flutter-ultra-native-desktop__wait_for_window` to detect native dialogs.
- `mcp__plugin_flutter_flutter-ultra-native-desktop__desktop_click` to interact with dialog buttons.
- `mcp__plugin_flutter_flutter-ultra-native-desktop__desktop_type` for text input in native fields.
- `mcp__plugin_flutter_flutter-ultra-native-desktop__select_file_in_dialog` for file picker dialogs.
- `mcp__plugin_flutter_flutter-ultra-native-desktop__confirm_dialog` to accept/dismiss confirmation dialogs.

### 8. Report the flow result

Produce a numbered summary: steps taken, pass/fail status per step, screenshot paths, and any errors from `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors`.

## Web launch modes

When launching a Flutter web app, choose the mode based on what the flow needs:

| Mode | Command | VM Service | Hot Reload | Startup | Best for |
|------|---------|-----------|-----------|---------|----------|
| `chrome` (default) | `-d chrome --headless=new` | Yes (DWDS) | Yes | 60-90s | Debugging, widget inspection, evaluate, state reading |
| `chrome-headed` | `-d chrome` (visible) | Yes (DWDS) | Yes | 60-90s | Local development, watching the agent work |
| `web-server` | `-d web-server` | No | No | 5-10s | Visual tours, screenshots, parallel subagent runs |

### When to use each mode

**Use `chrome` (default)** when the flow needs:
- Widget tree inspection (`get_widget_tree`, `find_widget`)
- Expression evaluation (`evaluate`)
- Hot reload after code changes
- Runtime error inspection (`get_runtime_errors`)
- Gesture tools via VM Service (`tap`, `enter_text`, `scroll_to`)

**Use `chrome-headed`** when:
- You want to visually watch the agent drive the app
- Debugging a flow that doesn't work headless (rare)

**Use `web-server`** when:
- The flow only needs screenshots and Playwright navigation
- Running multiple parallel app instances for subagent tours
- Fast iteration without waiting for DWDS connection
- Cross-browser testing (Firefox, WebKit via Playwright)

### Launching in each mode

```
# Default (chrome headless + DWDS):
launch_app(projectDir, target, device: "chrome")

# Chrome headed (visible + DWDS):
launch_app(projectDir, target, device: "chrome", webLaunchMode: "chrome-headed")

# Web-server (fast, no DWDS):
launch_app(projectDir, target, device: "chrome", webLaunchMode: "web-server", webPort: 8080)
```

For web-server mode, after `poll_launch_app` shows `attached`, use browser server tools:
- `mcp__plugin_flutter_flutter-ultra-browser__launch_browser` → navigate to `webServerUrl`
- `mcp__plugin_flutter_flutter-ultra-browser__screenshot` for captures
- `mcp__plugin_flutter_flutter-ultra-browser__click` / `fill` for interaction

### Parallel instances for subagent tours

Multiple app instances can run simultaneously on different ports. This enables parallel visual documentation where each subagent drives a different section of the app:

```
# Agent A: tour the auth flows
launch_app(projectDir, target, device: "chrome", webLaunchMode: "web-server", webPort: 8081)

# Agent B: tour the dashboard (simultaneous)
launch_app(projectDir, target, device: "chrome", webLaunchMode: "web-server", webPort: 8082)

# Agent C: tour settings (simultaneous)
launch_app(projectDir, target, device: "chrome", webLaunchMode: "web-server", webPort: 8083)
```

Each agent launches its own Playwright browser, navigates to its port, and captures screenshots independently. No shared state, no conflicts.

**Limitation**: `chrome` mode (with DWDS) does NOT support parallel instances to the same project — Flutter's machine-mode daemon locks the compile. Use `web-server` for parallelism.

## Handling edge cases

- **Element not found**: call `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` to find where the element is. Wait up to 3s via `mcp__plugin_flutter_flutter-ultra-gesture__wait_for`.
- **Wrong route**: `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to read `GoRouter.of(context).routerDelegate.currentConfiguration.fullPath`, then navigate to the correct starting point.
- **Text field requires focus**: tap the field first with `mcp__plugin_flutter_flutter-ultra-gesture__tap`, then `mcp__plugin_flutter_flutter-ultra-gesture__enter_text`.
- **Async loading**: `mcp__plugin_flutter_flutter-ultra-runtime__widget_exists` to check for `CircularProgressIndicator`; wait and retry.
- **Code change mid-flow**: `mcp__plugin_flutter_flutter-ultra-runtime__hot_reload` after edits, then re-verify the widget tree.

## Example

```
User: "Drive the login flow for user@example.com, then open the first invoice."

1. discover_sessions -> attach(sessionId: "flutter-1")
2. screenshot -> confirm login screen visible
3. interactive_elements -> found: email-field, password-field, sign-in-button
4. tap(key: "email-field") -> enter_text(text: "user@example.com")
5. tap(key: "password-field") -> enter_text(text: "password123")
6. tap(key: "sign-in-button")
7. wait_for(key: "dashboard-root") -> found
8. screenshot -> dashboard loaded
9. evaluate: context.go('/invoices')
10. wait_for(text: "Invoice #1") -> found
11. tap(text: "Invoice #1")
12. wait_for(key: "invoice-detail") -> found
13. screenshot -> invoice detail visible
-> "3 major steps completed. Final route: /invoices/1"
```

## See also

- `flutter-tour` — passive route screenshot sweeps without interaction
- `flutter-test` — orchestrated patrol E2E test runs
- `flutter-debug` — triage runtime errors encountered during a flow
