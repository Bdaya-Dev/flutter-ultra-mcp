# `ext.flutter.ultra.*` VM service extension catalogue

Every extension below is registered by `UltraFlutterBinding.initServiceExtensions()` when the binding is active. All extensions return a JSON envelope with `type: '_extensionType'`, `method`, and `status: 'Success'` on success; errors map to standard `developer.ServiceExtensionResponse` codes (`extensionErrorMin..extensionErrorMin+16` for typed errors, `invalidParams` for bad input).

## Parity matrix vs marionette

| `ext.flutter.ultra.*` | marionette equivalent            | Notes                                                                                |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| `getVersion`          | `marionette.getVersion`          | Returns `{version: <semver>}` from `src/version.g.dart`.                             |
| `interactiveElements` | `marionette.interactiveElements` | Returns `{elements: [...]}` from `ElementTreeFinder`.                                |
| `tap`                 | `marionette.tap`                 | Body: `WidgetMatcher` JSON (`key`/`text`/`type`/`x`+`y`/`focused`).                  |
| `doubleTap`           | `marionette.doubleTap`           | Optional `delay` (ms, positive). Default 100ms.                                      |
| `longPress`           | `marionette.longPress`           | Optional `duration` (ms). Default 600ms.                                             |
| `enterText`           | `marionette.enterText`           | Requires `input` plus a matcher.                                                     |
| `clearText`           | _(new — enhancement)_            | Convenience wrapper around `enterText('')`. Saves agents two round-trips.            |
| `swipe`               | `marionette.swipe`               | Either coord-based (`startX/Y` + `endX/Y`) or element + `direction` + `distance`.    |
| `pinchZoom`           | `marionette.pinchZoom`           | Required `scale`, optional `startDistance` (default 200).                            |
| `scrollTo`            | `marionette.scrollTo`            | Scrolls until the matched widget is visible.                                         |
| `getLogs`             | `marionette.getLogs`             | Requires a `LogCollector` in `UltraConfiguration`.                                   |
| `takeScreenshots`     | `marionette.takeScreenshots`     | Returns one screenshot per `RenderView`.                                             |
| `startScreencast`     | `marionette.startScreencast`     | Optional `maxWidth`, `maxHeight`, `wsPort`.                                          |
| `stopScreencast`      | `marionette.stopScreencast`      | Idempotent.                                                                          |
| `pressBackButton`     | `marionette.pressBackButton`     | Returns `didPop`.                                                                    |
| `listExtensions`      | `marionette.listExtensions`      | Returns user-registered custom extensions (registered via `registerUltraExtension`). |

15 extensions in total: 14 ported + 1 enhancement (`clearText`).

## Adding a custom extension

```dart
import 'package:ultra_flutter/ultra_flutter.dart';

void registerMyExtensions() {
  registerUltraExtension(
    name: 'myApp.fetchProfile', // becomes `ext.flutter.myApp.fetchProfile`
    description: 'Returns the currently-signed-in profile snapshot.',
    callback: (params) async {
      final id = params['id'];
      if (id == null) {
        return UltraExtensionResult.invalidParams('Missing "id"');
      }
      // ...
      return UltraExtensionResult.success({'profile': {/* ... */}});
    },
  );
}
```

Call `registerMyExtensions()` after `AppBinding.ensureInitialized()` and before `runApp()`. Custom extensions show up in the `listExtensions` response so the MCP server can advertise them to the LLM.

## Why `ext.flutter.ultra.*` and not `ext.ultra.*`

Flutter's DevTools and `package:vm_service` only allow registration under `ext.flutter.*` — the `flutter.` prefix is hard-coded by `developer.registerExtension` validation in our `register_extension_internal.dart`. The `ultra` second segment is our namespace.

## Planned future extensions

- `ultra.waitFor` — server-side polling that resolves when a matcher hits (saves agents N round-trips).
- `ultra.scrollUntilVisible` — single-call hybrid of `scrollTo` + `waitFor` for stubborn lazy lists.
- `ultra.matcher` — hierarchical matchers (`{type: 'TextField', ancestor: {key: 'login_form'}}`).

Tracked at plan §6.1; not in 0.0.1-dev.
