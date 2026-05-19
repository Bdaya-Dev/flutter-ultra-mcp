---
name: flutter-tour
description: Running route-by-route screenshot tours of a Flutter app. Use when capturing visual state across many app routes, doing pre-release visual regression sweeps, or documenting a feature's UI for review.
---

# flutter-tour — Route Screenshot Tour

## When to use

Use this skill when the user asks to visually document the app, capture all screens for review, or perform a pre-release sweep of the UI. Also use it when producing a screenshot inventory for a design QA pass.

## Prerequisites

- A Flutter app is already running in debug mode (or can be launched via `mcp__plugin_flutter_flutter-ultra-runtime__launch_app`).
- For web tours: a browser context is available or can be created via `mcp__plugin_flutter_flutter-ultra-browser__launch_browser`.
- The app uses GoRouter or Navigator 2.0 (route list can be discovered via `evaluate`).

## Workflow

1. **Attach to the running session**
   - Call `mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions` to find active sessions.
   - If none, call `mcp__plugin_flutter_flutter-ultra-runtime__launch_app` with the target project/flavor.
   - Call `mcp__plugin_flutter_flutter-ultra-runtime__attach` with the chosen `sessionId`.

2. **Discover routes**
   - Call `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` with:
     ```dart
     import 'package:go_router/go_router.dart';
     final router = GoRouter.of(context);
     router.configuration.routes.map((r) => r.path).toList().toString()
     ```
   - If GoRouter is not used, call `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` and look for `Navigator` or `MaterialApp` `routes` keys.
   - If the user supplied a route list explicitly, use that directly.

3. **For each route** (iterate in order):
   a. Navigate via evaluate:
      ```dart
      context.go('/your-route');
      ```
      Or for named routes: `context.goNamed('routeName')`.
   b. Wait for the UI to settle — call `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` with `SchedulerBinding.instance.endOfFrame` to await the next frame.
   c. Take a screenshot: `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — save path as `.omc/research/tour-<YYYY-MM-DD>/<route-slug>.png` where `route-slug` replaces `/` with `-` and strips leading `-`.
   d. For **web targets**: also call `mcp__plugin_flutter_flutter-ultra-browser__screenshot` for a pixel-perfect browser-rendered capture alongside the VM-service capture.
   e. Record the mapping `{ route, file, timestamp, title }` for the report.

4. **Handle auth-gated routes**
   - If a route redirects to a login screen, detect it by checking the widget tree for a login form key or `LoginPage` widget type.
   - Perform login via `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` (inject credentials into state) or via gesture tools.
   - Retry the navigation after authentication.

5. **Compile the report**
   - Write `.omc/research/tour-<date>/tour-report.md` with a markdown table:
     ```markdown
     | Route | Screenshot | Notes |
     |-------|-----------|-------|
     | /home | [home.png](./home.png) | |
     ```
   - List any routes that could not be captured and the reason (auth wall, crash, async timeout).

## Handling edge cases

- **Auth-gated routes**: detect redirect to login by calling `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` after navigation and checking top-level widget type. Authenticate first, then retry.
- **Routes with async data**: after `context.go(...)`, await `SchedulerBinding.instance.endOfFrame` and optionally call `evaluate` to check if a loading indicator is still present (`find.byType(CircularProgressIndicator).evaluate().isNotEmpty`). Wait up to 5 seconds in 500 ms increments.
- **Routes that cause errors**: catch exceptions from `evaluate`; log the error in the report and continue to the next route.
- **Parameterized routes** (e.g. `/item/:id`): substitute a known test ID, e.g. `/item/1`. Ask the user for sample IDs if none are obvious from context.
- **Bottom sheets / dialogs**: these are not routes in GoRouter. Capture them by triggering them via `evaluate` after navigating to the parent route, screenshot, then dismiss.

## Output format

At the end of the tour, produce:
1. A summary message listing how many routes were captured successfully vs. skipped.
2. The path to `tour-report.md`.
3. Inline markdown image links for any screenshots already visible in context (first 3 max to avoid flooding).

## Example

```
User: "Take a screenshot tour of the Invora app — all routes."

1. discover_sessions → sessionId: "flutter-1"
2. attach(sessionId: "flutter-1")
3. evaluate → routes: ["/", "/login", "/dashboard", "/invoices", "/invoices/:id", "/settings"]
4. For "/":
   - evaluate: context.go('/')
   - evaluate: await SchedulerBinding.instance.endOfFrame
   - screenshot → .omc/research/tour-2026-05-19/-home.png
5. For "/login":
   - evaluate: context.go('/login')
   - screenshot → .omc/research/tour-2026-05-19/-login.png
... (repeat for each route)
6. Write tour-report.md with table of all routes + image links.
```

## See also

- Sibling skill: `flutter-drive` for multi-step interaction flows
- `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` — arbitrary Dart expression evaluation in app context
- `mcp__plugin_flutter_flutter-ultra-browser__screenshot` — browser-level screenshot for web targets
