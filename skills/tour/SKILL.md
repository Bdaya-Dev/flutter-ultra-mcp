---
name: flutter-tour
description: Captures route-by-route screenshots of a running Flutter app for visual documentation and regression sweeps. Use when the user asks to visually document the app, capture all screens, do a pre-release visual sweep, create responsive screenshots at multiple breakpoints, or produce a screenshot inventory for design QA.
---

# Route Screenshot Tour

## Workflow

### 1. Connect to the app

- `mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions` to find active debug sessions.
- If none found, `mcp__plugin_flutter_flutter-ultra-runtime__launch_app` with the target project, device, and flavor.
  - Poll with `mcp__plugin_flutter_flutter-ultra-runtime__poll_launch_app` until attached.
- `mcp__plugin_flutter_flutter-ultra-runtime__attach` with the returned URI.
- For web targets, also `mcp__plugin_flutter_flutter-ultra-browser__launch_browser` or `mcp__plugin_flutter_flutter-ultra-browser__connect_over_cdp` to get a browser context.

### 2. Discover routes

Call `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to extract the route table:

```dart
GoRouter.of(navigatorKey.currentContext!).configuration.routes.map((r) => r.path).toList()
```

Fallback for Navigator 1.0: call `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` and find `Navigator` routes in the tree.

If the user supplied a route list, use that directly.

### 3. For each route

1. Navigate: `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` with `context.go('/route')`.
2. Wait for settle: call `mcp__plugin_flutter_flutter-ultra-gesture__wait_for` with a stable-frame check, or evaluate `SchedulerBinding.instance.endOfFrame`.
3. Check for loading indicators: `mcp__plugin_flutter_flutter-ultra-runtime__widget_exists` with type `CircularProgressIndicator`. Wait and retry up to 5s.
4. **Capture screenshots** (choose based on target):
   - VM screenshot: `mcp__plugin_flutter_flutter-ultra-runtime__screenshot`
   - Browser screenshot (web): `mcp__plugin_flutter_flutter-ultra-browser__screenshot`
   - Device screenshot (mobile): `mcp__plugin_flutter_flutter-ultra-native-mobile__take_device_screenshot`
   - Desktop screenshot: `mcp__plugin_flutter_flutter-ultra-native-desktop__desktop_screenshot`
5. **Responsive captures** (when requested): `mcp__plugin_flutter_flutter-ultra-gesture__take_responsive_screenshots` to capture at phone/tablet/desktop breakpoints in one call.
6. Record `{ route, file, timestamp }` for the report.

### 4. Video tours (optional)

For animated transitions between routes:

- `mcp__plugin_flutter_flutter-ultra-gesture__start_screencast` before starting navigation.
- Navigate through all routes with short pauses.
- `mcp__plugin_flutter_flutter-ultra-gesture__stop_screencast` to finalize the recording.

### 5. DevTools integration (optional)

Push live progress to a connected DevTools panel:

- `mcp__plugin_flutter_flutter-ultra-devtools__push_event` with `type: "screenshot"` and payload `{ route, path }` after each capture.

### 6. Handle edge cases

- **Auth-gated routes**: after navigation, check for a login widget via `mcp__plugin_flutter_flutter-ultra-runtime__find_widget`. Authenticate via `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` or gesture tools, then retry.
- **Parameterized routes** (`/item/:id`): substitute a known test ID. Ask the user for sample IDs if none are obvious.
- **Routes that crash**: catch errors from `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors`, log in the report, continue to the next route.
- **Async data loading**: poll `mcp__plugin_flutter_flutter-ultra-runtime__widget_exists` for loading indicators; wait up to 5s in 500ms increments.
- **Bottom sheets / dialogs**: trigger via `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` on the parent route, screenshot, dismiss.
- **Platform rendering**: use `mcp__plugin_flutter_flutter-ultra-runtime__set_platform_override` to capture iOS-style UI on a non-iOS device.

### 7. Compile the report

Write `tour-report.md` with a markdown table of all routes, screenshot paths, and notes. List skipped routes with reasons.

## Tool reference

| Action              | Tool                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| Find sessions       | `mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions`            |
| Launch app          | `mcp__plugin_flutter_flutter-ultra-runtime__launch_app`                   |
| Attach              | `mcp__plugin_flutter_flutter-ultra-runtime__attach`                       |
| Evaluate Dart       | `mcp__plugin_flutter_flutter-ultra-runtime__evaluate`                     |
| VM screenshot       | `mcp__plugin_flutter_flutter-ultra-runtime__screenshot`                   |
| Find widget         | `mcp__plugin_flutter_flutter-ultra-runtime__find_widget`                  |
| Widget exists       | `mcp__plugin_flutter_flutter-ultra-runtime__widget_exists`                |
| Platform override   | `mcp__plugin_flutter_flutter-ultra-runtime__set_platform_override`        |
| Runtime errors      | `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors`           |
| Wait for settle     | `mcp__plugin_flutter_flutter-ultra-gesture__wait_for`                     |
| Responsive shots    | `mcp__plugin_flutter_flutter-ultra-gesture__take_responsive_screenshots`  |
| Screencast start    | `mcp__plugin_flutter_flutter-ultra-gesture__start_screencast`             |
| Screencast stop     | `mcp__plugin_flutter_flutter-ultra-gesture__stop_screencast`              |
| Browser screenshot  | `mcp__plugin_flutter_flutter-ultra-browser__screenshot`                   |
| Browser launch      | `mcp__plugin_flutter_flutter-ultra-browser__launch_browser`               |
| Connect CDP         | `mcp__plugin_flutter_flutter-ultra-browser__connect_over_cdp`             |
| Device screenshot   | `mcp__plugin_flutter_flutter-ultra-native-mobile__take_device_screenshot` |
| Desktop screenshot  | `mcp__plugin_flutter_flutter-ultra-native-desktop__desktop_screenshot`    |
| Push DevTools event | `mcp__plugin_flutter_flutter-ultra-devtools__push_event`                  |

## Example

```
User: "Take a screenshot tour of all routes."

1. discover_sessions -> attach(sessionId: "flutter-1")
2. evaluate -> routes: ["/", "/login", "/dashboard", "/invoices", "/settings"]
3. For each route:
   - evaluate: context.go('/login')
   - wait_for -> settled
   - screenshot -> tour/login.png
   - take_responsive_screenshots -> tour/login-phone.png, tour/login-tablet.png
4. Write tour-report.md
-> "5 routes captured, 0 skipped. Report at tour-report.md"
```

## See also

- `flutter-drive` — interactive multi-step flows with assertions
- `flutter-debug` — triage runtime errors found during a tour
