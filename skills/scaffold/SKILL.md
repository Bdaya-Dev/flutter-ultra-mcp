---
name: flutter-scaffold
description: Scaffolding new Flutter projects or features following the conventions detected in the existing codebase. Use when starting a fresh app, adding a feature module, or generating boilerplate that should match an existing project's structure.
disable-model-invocation: true
---

# flutter-scaffold — Project and Feature Scaffolding

## When to use

User must explicitly trigger this skill with `/flutter:scaffold`. It is not auto-invoked because it creates files. Use when the user asks to create a new Flutter project, add a feature module, scaffold a new screen, set up state management, or add boilerplate that must match the project's existing conventions.

## Prerequisites

- For **project mode**: a target directory must be specified or agreed upon. Flutter SDK must be on PATH.
- For **feature mode**: a Flutter project must already exist and be identifiable by `list_projects`.
- The user must confirm the scaffolding plan before any files are written.

## Mode detection

Determine which mode to use from the user's request:

| User asks | Mode |
|-----------|------|
| "create a new Flutter app", "new project" | Project mode |
| "add a feature", "new screen", "scaffold [X] page/module" | Feature mode |
| "set up BLoC / Riverpod / Provider" | State management mode |
| "add a new route / page" | Screen mode (subset of feature mode) |

---

## Project mode — new Flutter app

1. Confirm with the user: project name, org (reverse domain), target directory, and Flutter channel (stable/beta).
2. Run via shell (Bash tool):
   ```bash
   flutter create --org com.example --project-name my_app ./my_app
   ```
3. Call `mcp__plugin_flutter_flutter-ultra-build__pub_get` on the new project to fetch dependencies.
4. Call `mcp__plugin_flutter_flutter-ultra-build__analyze` to confirm a clean baseline.
5. Ask the user if they want state management, routing, or localization scaffolded next — then proceed to the relevant feature mode sections below.

---

## Feature mode — detect existing conventions first

Before creating any files, call `mcp__plugin_flutter_flutter-ultra-build__project_info` on the target project to read:
- Project root and `lib/` structure
- Existing dependencies (from `pubspec.yaml`)

Then detect the project's conventions by reading `pubspec.yaml` dependencies:

| Detected dep | State management pattern |
|---|---|
| `flutter_bloc` / `bloc` | BLoC pattern |
| `riverpod` / `flutter_riverpod` | Riverpod |
| `provider` | Provider |
| None of the above | Ask the user which to use |

| Detected dep | Routing pattern |
|---|---|
| `go_router` | GoRouter |
| `auto_route` | AutoRoute |
| None | Navigator 1.0 (push/pop) |

Announce detected conventions to the user before scaffolding.

---

## Screen scaffolding (new route/page)

For each new screen, create the following files following the detected pattern:

### File structure (BLoC + GoRouter example for `InvoiceList`):
```
lib/
  features/
    invoice_list/
      bloc/
        invoice_list_bloc.dart      # BLoC class
        invoice_list_event.dart     # events sealed class
        invoice_list_state.dart     # states sealed class
      view/
        invoice_list_page.dart      # BlocProvider wrapper
        invoice_list_view.dart      # stateless widget body
      invoice_list.dart             # barrel export
test/
  features/
    invoice_list/
      bloc/
        invoice_list_bloc_test.dart
```

For **Riverpod**: replace `bloc/` with `provider/` containing a `StateNotifier` or `AsyncNotifier`.
For **Provider**: replace `bloc/` with `provider/` containing a `ChangeNotifier`.

### Route registration (GoRouter):

Add the new route to the router config file (detect by searching for `GoRouter(` in `lib/`):
```dart
GoRoute(
  path: '/invoice-list',
  name: 'invoiceList',
  builder: (context, state) => const InvoiceListPage(),
),
```

### After creating files:

1. Call `mcp__plugin_flutter_flutter-ultra-build__format` on the new files to normalize formatting.
2. Call `mcp__plugin_flutter_flutter-ultra-build__analyze` — fix any errors before reporting done.
3. Do **not** call `pub_get` unless new packages were added.

---

## State management setup (first-time)

When the project has no state management and the user wants to add one:

**BLoC:**
1. Call `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `flutter_bloc bloc equatable`.
2. Call `mcp__plugin_flutter_flutter-ultra-build__pub_get`.
3. Scaffold the first BLoC as described in the screen section above.

**Riverpod:**
1. Call `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `flutter_riverpod riverpod_annotation` and dev deps `riverpod_generator build_runner`.
2. Call `mcp__plugin_flutter_flutter-ultra-build__pub_get`.
3. Wrap `main.dart`'s `runApp` with `ProviderScope`.
4. Call `mcp__plugin_flutter_flutter-ultra-build__start_build_runner_build` → `poll_build_runner_job` → `get_build_runner_result` to generate initial code.

**Provider:**
1. Call `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `provider`.
2. Call `mcp__plugin_flutter_flutter-ultra-build__pub_get`.

---

## Localization scaffolding

When the user asks to add l10n:
1. Call `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `flutter_localizations` (SDK package).
2. Create `lib/l10n/app_en.arb` with a minimal key set.
3. Add `generate: true` to `pubspec.yaml` under `flutter:`.
4. Call `mcp__plugin_flutter_flutter-ultra-build__flutter_gen_l10n` to generate the `AppLocalizations` class.
5. Add `localizationsDelegates` and `supportedLocales` to the `MaterialApp`.

---

## Confirmation and safety rules

- **Always announce the file list** that will be created before writing. Wait for user confirmation if the list is more than 3 files.
- **Never overwrite existing files** without explicit user confirmation.
- **Match the existing naming convention**: if existing files use `snake_case` feature directories, continue that pattern; if they use `camelCase`, match it.
- After scaffolding, run `analyze` and surface any errors — do not report done if there are errors.

## See also

- Sibling skill: `flutter-test` for writing tests after scaffolding
- Sibling skill: `flutter-debug` for inspecting live state in scaffolded features
- `mcp__plugin_flutter_flutter-ultra-build__project_info` — reads project structure and dependencies
- `mcp__plugin_flutter_flutter-ultra-build__analyze` — validates scaffolded code compiles clean
