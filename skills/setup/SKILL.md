---
name: flutter-setup
description: One-command setup of the flutter-ultra-mcp plugin in an existing Flutter codebase. Use when the user wants to enable flutter-ultra for the first time, or when re-running after a clean install. Idempotent — safe to run again if a previous attempt was partial.
---

# flutter-setup — One-Command Plugin Setup

## When to use

Use this skill when the user wants to wire up the flutter-ultra-mcp plugin into a Flutter project for the first time, or when verifying that a previously attempted setup is complete and working. The expected end state is: `UltraFlutterBinding` initialized in the app entry point, `ultra_flutter` in `dev_dependencies`, patrol fork overridden in `pubspec_overrides.yaml`, and a smoke launch confirming the VM Service attaches correctly.

## Prerequisites

- Flutter SDK installed and on PATH (`flutter --version` must succeed).
- Node.js ≥ 18 installed (required for the MCP servers).
- The target project has a `pubspec.yaml` (i.e., it is a Flutter app, not a pure Dart package).
- The user is working from the project root (or has provided an absolute path to it).

## Workflow

### 1. Verify the environment

- Call `mcp__plugin_flutter_flutter-ultra-build__flutter_doctor` with the project root.
  - If any `[✗]` entries appear for Flutter SDK, connected devices, or Dart, stop and surface the doctor output to the user. Do not continue until the environment is healthy.
- Call `mcp__plugin_flutter_flutter-ultra-build__project_info` with the project root.
  - Note: `entryPoints` (usually `lib/main.dart` or `lib/bootstrap.dart`), `hasSentry` (affects binding pattern), `hasPatrol` (determines whether to configure the patrol fork override).

### 2. Add `ultra_flutter` to dev_dependencies

- Call `mcp__plugin_flutter_flutter-ultra-build__pub_add` with:
  - `package`: `ultra_flutter`
  - `dev`: `true`
- If `pub_add` fails because `ultra_flutter` is not on pub.dev (it is a local plugin bundled with the MCP server), use `pubspec_overrides_set` to point to the bundled path instead:
  - Call `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_set` with `package: ultra_flutter` and `path` set to the absolute path of the bundled package (ask the user or read from plugin config if available).
  - Then add the dependency manually by editing `pubspec.yaml`: add `ultra_flutter: any` under `dev_dependencies`.
  - Call `mcp__plugin_flutter_flutter-ultra-build__pub_get` to resolve.

### 3. Patch the app entry point

Read the primary entry point file identified in step 1. Apply the following pattern:

**Without Sentry** — wrap the existing `runApp` call:

```dart
import 'package:flutter/foundation.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

void main() {
  if (kDebugMode) {
    UltraFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}
```

**With Sentry** (when `hasSentry: true`) — Sentry installs its own binding; use the direct mixin pattern:

```dart
import 'package:flutter/foundation.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

// In your custom binding class:
class AppBinding extends WidgetsFlutterBinding with UltraFlutterBindingMixin {
  static AppBinding ensureInitialized() =>
      WidgetsFlutterBinding.ensureInitialized() as AppBinding;
}

void main() {
  AppBinding.ensureInitialized();
  // ... Sentry.init wrapping runApp as before
}
```

Edit the file with the appropriate pattern. Only add the import and the `ensureInitialized` call — do not reorganize the existing code.

### 4. Configure the patrol fork override (if patrol detected)

When `project_info` reported `hasPatrol: true`:

- Call `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_list` to check if a `patrol` override already exists.
- If not present, call `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_set` with:
  - `package`: `patrol`
  - `path`: the vendored patrol fork path bundled with flutter-ultra-mcp (located at `<plugin-root>/packages/flutter-ultra-patrol/vendor/patrol` — ask the user for `<plugin-root>` if not available in context).
- Call `mcp__plugin_flutter_flutter-ultra-build__pub_get` to resolve the override.

### 5. Run static analysis to verify the setup

- Call `mcp__plugin_flutter_flutter-ultra-build__pub_get` (ensure lock file is current after all edits).
- Call `mcp__plugin_flutter_flutter-ultra-build__analyze` with the project root.
  - If any errors reference `ultra_flutter` or `UltraFlutterBinding`, the import or mixin was not applied correctly — re-read the entry point and fix.
  - Warnings about `// ignore: implementation_imports` on the Sentry path are expected; surface them to the user as informational only.

### 6. Smoke test: launch, attach, screenshot

- Call `mcp__plugin_flutter_flutter-ultra-runtime__launch_app` with the project root and target device (default: `chrome` for web projects, `linux`/`macos`/`windows` for desktop, first connected device for mobile).
  - Poll `mcp__plugin_flutter_flutter-ultra-runtime__poll_launch_app` until status is `ready` or `error`.
  - If `error`, surface the launch log to the user and stop.
- Call `mcp__plugin_flutter_flutter-ultra-runtime__attach` with the returned `sessionId`.
- Call `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — save to `.omc/research/setup-smoke-<YYYY-MM-DD>.png`.
- Call `mcp__plugin_flutter_flutter-ultra-runtime__detach`.
- Call `mcp__plugin_flutter_flutter-ultra-runtime__stop_app` with the `sessionId`.

If screenshot succeeds and the image is not blank, the setup is confirmed working.

## Handling edge cases

- **`UltraFlutterBinding.ensureInitialized()` already present**: `project_info` reports `hasUltraBinding: true`. Skip step 3 but still run steps 5–6 to confirm working state.
- **Multiple entry points** (e.g. `main_dev.dart`, `main_prod.dart`): patch all of them with the same binding initialization. Confirm with the user if the list is longer than 3 files before editing.
- **Monorepo / workspace**: `pubspec_overrides.yaml` must exist in each app package that needs ultra. Run steps 2–6 for each app package separately.
- **pub_get fails after overrides**: common cause is a mismatched `patrol` version in `pubspec.yaml` vs. the fork. Call `mcp__plugin_flutter_flutter-ultra-build__pub_outdated` to inspect version constraints, then relax the constraint in `pubspec.yaml` to `any` for the overridden package.
- **analyze reports `ultra_flutter` not found**: the `pubspec_overrides.yaml` path is wrong. Call `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_list` to verify the resolved path, then correct it.
- **launch_app times out**: the app may require dart-defines (e.g. OIDC client IDs). Call `mcp__plugin_flutter_flutter-ultra-build__list_dart_defines` to discover required defines, then relaunch with them.

## Output format

After the workflow completes, produce:

1. **Status**: `setup complete` or `setup failed at step N`.
2. **Changes made**: bullet list of files edited (entry points, `pubspec.yaml`, `pubspec_overrides.yaml`).
3. **Smoke test result**: path to the saved screenshot, or the error message if launch failed.
4. **Next steps**: suggest running `/flutter-tour` to capture a visual baseline, or `/flutter-debug` if the smoke test revealed a runtime error.

## Example

```
User: "Set up flutter-ultra on the Invora Flutter app."

1. flutter_doctor → all checks pass
2. project_info → entryPoints: ["lib/bootstrap.dart"], hasSentry: true, hasPatrol: true
3. pub_add ultra_flutter dev:true → added to pubspec.yaml
4. Edit lib/bootstrap.dart — add UltraFlutterBindingMixin to AppBinding class
5. pubspec_overrides_set patrol → path: /home/user/.claude/plugins/flutter-ultra-mcp/vendor/patrol
6. pub_get → resolved
7. analyze → 0 errors, 1 warning (ignore: implementation_imports — expected)
8. launch_app device:chrome → sessionId: "flutter-1"
9. attach(sessionId: "flutter-1")
10. screenshot → .omc/research/setup-smoke-2026-05-19.png (dashboard visible)
11. detach + stop_app

Setup complete. 3 files changed. Smoke screenshot saved.
Next: run /flutter-tour to capture a full visual baseline.
```

## See also

- Sibling skill: `flutter-tour` — visual screenshot tour after setup
- Sibling skill: `flutter-debug` — triage if the smoke launch reveals a runtime error
- `mcp__plugin_flutter_flutter-ultra-build__project_info` — entry point and feature detection
- `mcp__plugin_flutter_flutter-ultra-runtime__launch_app` — launch app for smoke test
- `mcp__plugin_flutter_flutter-ultra-build__pubspec_overrides_set` — configure patrol fork override
