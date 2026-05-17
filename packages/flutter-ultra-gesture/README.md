# @flutter-ultra/flutter-ultra-gesture

MCP server for **gesture dispatch** inside a running Flutter app via the in-app `ultra_flutter` mixin. Tools call `ext.flutter.ultra.*` service extensions registered by `UltraFlutterBinding` in the target app, so the app must include `package:ultra_flutter` and register the binding for any tool here to work.

## Prerequisites

- A Flutter app running in `--debug` mode with `package:ultra_flutter` ≥ 0.0.1 registered as a binding mixin.
- The runtime server (`@flutter-ultra/flutter-ultra-runtime`) attached to the session — it owns session discovery and publishes `state/sessions.json` + `state/session-<id>.json`. This server is a read-only consumer of that state.

## Tool catalogue (17)

| Tool                                   | Maps to                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interactive_elements`                 | `ext.flutter.ultra.interactiveElements` (rev-23 tightened: no truncation by default, optional pagination, sortBy, `withinSubtree` + `kinds` + `hasKey` filters) |
| `tap` / `double_tap` / `long_press`    | `ext.flutter.ultra.tap` / `.doubleTap` / `.longPress`                                                                                                           |
| `enter_text` / `clear_text`            | `ext.flutter.ultra.enterText` / `.clearText`                                                                                                                    |
| `swipe` / `pinch_zoom`                 | `ext.flutter.ultra.swipe` / `.pinchZoom`                                                                                                                        |
| `scroll_to` / `scroll_until_visible`   | `ext.flutter.ultra.scrollTo` (server-side polling for `scroll_until_visible`)                                                                                   |
| `take_screenshots`                     | `ext.flutter.ultra.takeScreenshots`                                                                                                                             |
| `take_responsive_screenshots`          | Delegates: web → `flutter-ultra-browser` (CDP `setDeviceMetricsOverride`); native → single-viewport fallback w/ `nativeMultiViewportUnavailable` warning        |
| `start_screencast` / `stop_screencast` | `ext.flutter.ultra.startScreencast` / `.stopScreencast`                                                                                                         |
| `call_custom_extension`                | invokes any user-registered `registerUltraExtension(name, ...)`                                                                                                 |
| `list_custom_extensions`               | `ext.flutter.ultra.listExtensions`                                                                                                                              |
| `wait_for`                             | server-side polling: `interactiveElements` every 200ms with finder match                                                                                        |

## Finder spec

All matcher-accepting tools share `FinderSpec` (Zod discriminated union):

```ts
{ kind: 'key',     value: string }
{ kind: 'text',    value: string, matchType?: 'exact' | 'contains' | 'regex' }  // default 'exact'
{ kind: 'type',    value: string }
{ kind: 'coords',  x: number, y: number }
{ kind: 'focused' }
{ kind: 'tooltip', value: string }     // server-side filter via interactiveElements
{ kind: 'semantics', label: string, matchType?: 'exact' | 'contains' }  // server-side filter
{ kind: 'descendant', of: FinderSpec, matching: FinderSpec }            // server-side filter
```

Server-side filters (`tooltip`/`semantics`/`descendant`) materialise the element list via `interactive_elements`, resolve a coordinate, then issue `ext.flutter.ultra.tap` with `{x, y}`. Native finders (`key`/`text`/`type`/`coords`/`focused`) call the extension directly.

## Configuration

Reads `state/sessions.json` and `state/session-<id>.json` written by `flutter-ultra-runtime`. Override the state directory with `FLUTTER_ULTRA_STATE_DIR` (defaults to `${FLUTTER_ULTRA_DATA:-~/.flutter-ultra-mcp}/state`).

DDS client name is `flutter-ultra/gesture/<pid>` so this server identifies as a distinct DDS client from the runtime server (per plan §7.2).

## Coordination

This server **never writes** to `sessions.json`. Session lifecycle is owned by `flutter-ultra-runtime`. We open our own VM-service WebSocket per session and cache one `VmServiceClient` per active session id. The cache is dropped when the runtime server marks the session `terminated`.
