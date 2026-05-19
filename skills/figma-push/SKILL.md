---
name: flutter-figma-push
description: Push Flutter web app UI to Figma as editable layers. Navigates to each route, captures the browser view, and uses the Figma MCP to create editable Figma frames from the live app screenshots.
disable-model-invocation: true
---

# Flutter Figma Push

Push screenshots of a running Flutter web app into Figma as editable frames. Web only — requires a browser-accessible Flutter app.

## Prerequisites

- Flutter web app is running and accessible via a browser URL.
- Figma MCP plugin is installed and authenticated.
- User has an existing Figma file URL to push frames into (or a new file will be created).

## Workflow

### 1. Confirm the app is running

```
mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions
```

If no session is found, ask the user for the browser URL of the Flutter web app directly.

### 2. Connect the browser

```
mcp__plugin_flutter_flutter-ultra-browser__launch_browser
```

Then navigate to the Flutter web app URL:

```
mcp__plugin_flutter_flutter-ultra-browser__navigate
  url: <flutter-web-app-url>
```

If the app is already open in a browser, connect over CDP instead:

```
mcp__plugin_flutter_flutter-ultra-browser__connect_over_cdp
  wsEndpoint: <devtools-ws-url>
```

### 3. Collect the route list

Ask the user for the list of routes to capture, or infer from the app's navigation structure via:

```
mcp__plugin_flutter_flutter-ultra-runtime__find_widget
  sessionId: <id>
  finder: { type: 'Navigator' }
```

Typical routes to capture: `/`, `/home`, `/profile`, `/settings`, and any primary feature screens.

### 4. For each route — capture and push

Repeat this sequence for every route:

#### 4a. Navigate

```
mcp__plugin_flutter_flutter-ultra-browser__navigate
  url: <flutter-web-app-url>/<route>
```

#### 4b. Wait for Flutter render to settle

```
mcp__plugin_flutter_flutter-ultra-browser__wait_for_url
  url: <expected-url>
```

Allow 1–2 seconds for animations to complete. Check console for any errors:

```
mcp__plugin_flutter_flutter-ultra-browser__console_logs
```

#### 4c. Take a browser screenshot

```
mcp__plugin_flutter_flutter-ultra-browser__screenshot
```

This captures the full browser viewport as rendered by the Flutter web engine.

#### 4d. Push to Figma

```
mcp__plugin_figma_figma__generate_figma_design
  url: <figma-file-url>
  imageData: <screenshot-data>
  frameName: <route-name>
```

The Figma MCP creates an editable frame from the screenshot. The frame name should match the route (e.g., `Flutter / home`, `Flutter / settings`).

### 5. Capture at multiple viewports (optional)

For responsive design, repeat step 4 at each breakpoint by resizing the browser viewport via JavaScript:

```
mcp__plugin_flutter_flutter-ultra-browser__evaluate_js
  expression: "window.resizeTo(375, 667)"
```

Then re-navigate and push with a viewport-suffixed frame name (e.g., `Flutter / home / compact`).

Standard breakpoints: compact (375×667), medium (768×1024), expanded (1200×800).

### 6. Report

After all routes are pushed, produce a summary:

```
## Figma Push Complete

| Route | Viewport | Figma frame | Status |
| ----- | -------- | ----------- | ------ |
| /home | 375×667  | Flutter / home / compact | created |
| /home | 1200×800 | Flutter / home / expanded | created |
| ...   |          |             |        |

Figma file: <url>
Total frames created: N
```

Include the Figma file URL so the user can open it directly.

## Notes

- This skill is web-only. Mobile screenshots require `mcp__plugin_flutter_flutter-ultra-native-mobile__take_device_screenshot` and cannot be pushed directly to Figma via the browser path.
- CanvasKit (default Flutter web renderer) renders to a `<canvas>` element — the browser screenshot captures the correct visual output.
- If `generate_figma_design` is unavailable, fall back to `mcp__plugin_figma_figma__use_figma` to upload the screenshot as an image asset.

## See also

- `flutter-design-verify` — compare Flutter screenshots against existing Figma frames for drift detection
- `flutter-design-audit` — run design quality checks on the live Flutter app
