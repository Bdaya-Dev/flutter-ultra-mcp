---
name: flutter-setup
description: One-command setup of the flutter-ultra-mcp plugin in an existing Flutter codebase. Use when the user wants to enable flutter-ultra for the first time, re-run after a clean install, or verify an existing setup is complete and working. Idempotent and safe to re-run.
---

# Plugin Setup

Expected end state: `UltraFlutterBinding` initialized in the app entry point, `ultra_flutter` in `dependencies`, patrol fork overridden if needed, and a smoke launch confirming the VM Service attaches correctly.

## Workflow

### 1. Verify the environment

- `mcp__plugin_flutter_flutter-ultra-build__flutter_doctor` — stop if Flutter SDK, devices, or Dart show `[x]`.
- `mcp__plugin_flutter_flutter-ultra-build__project_info` — note entry points, `hasSentry`, `hasPatrol`, `hasUltraBinding`.
- `mcp__plugin_flutter_flutter-ultra-runtime__list_devices` — verify at least one target device is available.
- `mcp__plugin_flutter_flutter-ultra-build__list_dart_defines` — discover required dart-defines for launch.
- `mcp__plugin_flutter_flutter-ultra-build__list_flavors` — check for flavor configuration.

### 2. Add `ultra_flutter` to dependencies

- `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `package: ultra_flutter` (NOT dev — it runs in the app process, guarded by `kDebugMode`).
- If it fails (not on pub.dev), use `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_set` to point to the bundled path, add `ultra_flutter: any` under `dependencies` manually, then `mcp__plugin_flutter_flutter-ultra-build__pub_get`.

### 3. Patch the app entry point

**Without Sentry:**

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

void main() {
  if (kDebugMode) {
    UltraFlutterBinding.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}
```

**With Sentry** (composed binding class — both mixins on one binding):

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

class AppBinding extends WidgetsFlutterBinding
    with SentryWidgetsBindingMixin, UltraFlutterBinding {}

void main() async {
  if (kDebugMode) {
    AppBinding();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  await SentryFlutter.init((options) { /* ... */ });
  runApp(const MyApp());
}
```

The `on WidgetsBinding` constraint lets `UltraFlutterBinding` compose with any other mixin — Sentry, integration_test, or custom bindings. Only one binding class can exist per process, so both mixins must be on the same class.

Skip if `project_info` reported `hasUltraBinding: true`.

### 4. Configure patrol fork override (if patrol detected)

- `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_list` — check if `patrol` override exists.
- If not: `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_set` with `package: patrol` and the vendored fork path.
- `mcp__plugin_flutter_flutter-ultra-build__pub_get` to resolve.

### 5. Static analysis

- `mcp__plugin_flutter_flutter-ultra-build__pub_get` — ensure lock file is current.
- `mcp__plugin_flutter_flutter-ultra-build__analyze` — fix any errors referencing `ultra_flutter` or `UltraFlutterBinding`.
- If analysis finds other pre-existing issues: `mcp__plugin_flutter_flutter-ultra-build__fix` to auto-apply safe lint fixes.

### 6. Smoke test: launch, attach, screenshot

- `mcp__plugin_flutter_flutter-ultra-runtime__launch_app` with the project root and target device (default: `chrome` for web, platform default for desktop, first connected device for mobile).
  - Pass `importLaunchJsonConfig` if `.vscode/launch.json` has dart-defines.
- `mcp__plugin_flutter_flutter-ultra-runtime__poll_launch_app` until status is `attached` or `failed`.
- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` to capture the running app.
- `mcp__plugin_flutter_flutter-ultra-runtime__detach`.
- `mcp__plugin_flutter_flutter-ultra-runtime__stop_app`.

If screenshot succeeds and is not blank, setup is confirmed working.

### 7. Build verification (optional, when requested)

Verify the app builds for all target platforms using the build server's platform-specific start/poll/get/cancel tool sets. Each platform follows the same pattern: `start_build_{platform}` -> `poll_build_{platform}_job` -> `get_build_{platform}_result`. Supported platforms: apk, appbundle, ipa (macOS only), web, windows, macos, linux.

## Edge cases

- **`UltraFlutterBinding.ensureInitialized()` already present**: skip step 3, run steps 5-6 to confirm.
- **Multiple entry points** (`main_dev.dart`, `main_prod.dart`): patch all of them. Confirm with the user if more than 3 files.
- **Monorepo / workspace**: run steps 2-6 for each app package separately.
- **pub_get fails after overrides**: `mcp__plugin_flutter_flutter-ultra-build__pub_outdated` to inspect version constraints, then relax to `any`.
- **analyze reports `ultra_flutter` not found**: `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_list` to verify the resolved path.
- **launch_app times out**: check `mcp__plugin_flutter_flutter-ultra-build__list_dart_defines` for required defines, relaunch with them.
- **Pub cache corruption**: `mcp__plugin_flutter_flutter-ultra-build__pub_cache_repair` to rebuild the cache, then retry pub_get.
- **Stale build artifacts**: `mcp__plugin_flutter_flutter-ultra-build__flutter_clean` to clear, then rebuild.

## Tool reference

| Action               | Tool                                                              |
| -------------------- | ----------------------------------------------------------------- |
| Flutter doctor       | `mcp__plugin_flutter_flutter-ultra-build__flutter_doctor`         |
| Project info         | `mcp__plugin_flutter_flutter-ultra-build__project_info`           |
| List devices         | `mcp__plugin_flutter_flutter-ultra-runtime__list_devices`         |
| List dart defines    | `mcp__plugin_flutter_flutter-ultra-build__list_dart_defines`      |
| List flavors         | `mcp__plugin_flutter_flutter-ultra-build__list_flavors`           |
| Add dependency       | `mcp__plugin_flutter_flutter-ultra-build__pub_add`                |
| Resolve deps         | `mcp__plugin_flutter_flutter-ultra-build__pub_get`                |
| Overrides set        | `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_set`  |
| Overrides list       | `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_list` |
| Analyze              | `mcp__plugin_flutter_flutter-ultra-build__analyze`                |
| Auto-fix             | `mcp__plugin_flutter_flutter-ultra-build__fix`                    |
| Flutter clean        | `mcp__plugin_flutter_flutter-ultra-build__flutter_clean`          |
| Pub cache repair     | `mcp__plugin_flutter_flutter-ultra-build__pub_cache_repair`       |
| Pub outdated         | `mcp__plugin_flutter_flutter-ultra-build__pub_outdated`           |
| Launch app           | `mcp__plugin_flutter_flutter-ultra-runtime__launch_app`           |
| Poll launch          | `mcp__plugin_flutter_flutter-ultra-runtime__poll_launch_app`      |
| Attach               | `mcp__plugin_flutter_flutter-ultra-runtime__attach`               |
| Screenshot           | `mcp__plugin_flutter_flutter-ultra-runtime__screenshot`           |
| Detach               | `mcp__plugin_flutter_flutter-ultra-runtime__detach`               |
| Stop app             | `mcp__plugin_flutter_flutter-ultra-runtime__stop_app`             |
| Build (any platform) | `start_build_{platform}` via the build server                     |

## Output format

1. **Status**: `setup complete` or `setup failed at step N`.
2. **Changes made**: bullet list of files edited.
3. **Smoke test result**: screenshot path or error message.
4. **Next steps**: suggest `/flutter:tour` for a visual baseline or `/flutter:debug` if the smoke test failed.

## Example

```
User: "Set up flutter-ultra on my app."

1. flutter_doctor -> all checks pass
2. project_info -> entryPoints: ["lib/main.dart"], hasSentry: false, hasPatrol: false
3. list_devices -> chrome, windows
4. pub_add ultra_flutter -> added to dependencies
5. Edit lib/main.dart -> add UltraFlutterBinding.ensureInitialized()
6. pub_get -> resolved
7. analyze -> 0 errors
8. launch_app(device: "chrome") -> poll -> attached
9. screenshot -> app visible
10. detach + stop_app
-> "Setup complete. 2 files changed. Smoke screenshot saved."
```

## Known issues

### Sentry zone mismatch warning on web

When using the composed binding pattern with Sentry (`SentryWidgetsBindingMixin` + `UltraFlutterBinding`), Flutter may emit a "Zone mismatch" assertion warning on web. This happens because Sentry wraps `appRunner` in `runZonedGuarded`, and the binding is created in a different zone than where `runApp` executes.

**This warning is non-fatal** — the app works correctly. To minimize it, create the binding inside Sentry's zone guard:

```dart
Future<void> main() async {
  await SentryFlutter.init(
    (options) { options.dsn = '...'; },
    appRunner: () {
      if (kDebugMode) {
        AppBinding();
      } else {
        WidgetsFlutterBinding.ensureInitialized();
      }
      runApp(const MyApp());
    },
  );
}
```

### Inspector extensions unavailable on web (DWDS)

`ext.flutter.inspector.screenshot` and `ext.flutter.inspector.getRootWidgetSummaryTree` fail on web targets with `(-32000) Server error`. This is a known Flutter DWDS limitation ([flutter/flutter#97898](https://github.com/flutter/flutter/issues/97898)). The runtime server automatically falls back to `ext.flutter.ultra.*` extensions when the inspector fails, and then to CDP `Page.captureScreenshot` for screenshots on web.

## See also

- `flutter-tour` — visual screenshot tour after setup
- `flutter-debug` — triage if the smoke launch reveals a runtime error
- `flutter-devtools` — wire up the DevTools panel for live inspection
