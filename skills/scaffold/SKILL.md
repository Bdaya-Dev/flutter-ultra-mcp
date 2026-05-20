---
name: flutter-scaffold
description: Scaffolds new Flutter projects or features following conventions detected in the existing codebase. Use when starting a fresh app, adding a feature module, generating boilerplate that should match the project's structure, setting up state management, or configuring localization.
disable-model-invocation: true
---

# Project and Feature Scaffolding

User must explicitly trigger this skill with `/flutter:scaffold`. It creates files and is not auto-invoked.

## Mode detection

| User asks                     | Mode                  |
| ----------------------------- | --------------------- |
| "create a new Flutter app"    | Project mode          |
| "add a feature", "new screen" | Feature mode          |
| "set up BLoC / Riverpod"      | State management mode |
| "add localization"            | L10n mode             |

## Project mode

1. Confirm: project name, org, target directory, Flutter channel.
2. Create via shell: `flutter create --org com.example --project-name my_app ./my_app`.
3. `mcp__plugin_flutter_flutter-ultra-build__pub_get` to fetch dependencies.
4. `mcp__plugin_flutter_flutter-ultra-build__analyze` to confirm clean baseline.
5. `mcp__plugin_flutter_flutter-ultra-build__flutter_doctor` to verify the environment.
6. Ask if state management, routing, or l10n scaffolding is needed.

## Feature mode — detect conventions first

Call `mcp__plugin_flutter_flutter-ultra-build__project_info` to read project structure and dependencies.

Detect the project's state management from `pubspec.yaml`:

| Dependency                      | Pattern      |
| ------------------------------- | ------------ |
| `flutter_bloc` / `bloc`         | BLoC         |
| `riverpod` / `flutter_riverpod` | Riverpod     |
| `provider`                      | Provider     |
| None                            | Ask the user |

Detect routing: `go_router` = GoRouter, `auto_route` = AutoRoute, none = Navigator 1.0.

Announce detected conventions before scaffolding.

### Screen scaffolding (BLoC + GoRouter example)

```
lib/features/invoice_list/
  bloc/
    invoice_list_bloc.dart
    invoice_list_event.dart
    invoice_list_state.dart
  view/
    invoice_list_page.dart
    invoice_list_view.dart
  invoice_list.dart           # barrel export
test/features/invoice_list/
  bloc/
    invoice_list_bloc_test.dart
```

### After creating files

1. `mcp__plugin_flutter_flutter-ultra-build__format` to normalize formatting.
2. `mcp__plugin_flutter_flutter-ultra-build__analyze` to confirm clean compilation.
3. If codegen is needed (Riverpod generators, freezed): `mcp__plugin_flutter_flutter-ultra-build__start_build_runner_build` -> `mcp__plugin_flutter_flutter-ultra-build__poll_build_runner_job` -> `mcp__plugin_flutter_flutter-ultra-build__get_build_runner_result`.

## State management setup

**BLoC:**

1. `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `flutter_bloc bloc equatable`.
2. `mcp__plugin_flutter_flutter-ultra-build__pub_get`.

**Riverpod:**

1. `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `flutter_riverpod riverpod_annotation` + dev deps `riverpod_generator build_runner`.
2. `mcp__plugin_flutter_flutter-ultra-build__pub_get`.
3. Run build_runner to generate initial code.

**Provider:**

1. `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `provider`.
2. `mcp__plugin_flutter_flutter-ultra-build__pub_get`.

## Localization setup

1. `mcp__plugin_flutter_flutter-ultra-build__pub_add` with `flutter_localizations` (SDK package).
2. Create `lib/l10n/app_en.arb` with a minimal key set.
3. Add `generate: true` to `pubspec.yaml` under `flutter:`.
4. `mcp__plugin_flutter_flutter-ultra-build__flutter_gen_l10n` to generate the `AppLocalizations` class.
5. Add `localizationsDelegates` and `supportedLocales` to `MaterialApp`.
6. Verify: `mcp__plugin_flutter_flutter-ultra-build__list_missing_translations` to check all locales have translations.

## Asset management

When the scaffold includes images or other assets:

1. `mcp__plugin_flutter_flutter-ultra-build__add_asset` to register assets in `pubspec.yaml`.
2. `mcp__plugin_flutter_flutter-ultra-build__validate_assets` to confirm all referenced assets exist on disk.
3. `mcp__plugin_flutter_flutter-ultra-build__list_orphan_assets` to find assets on disk not referenced in code.

## Web configuration

For web-targeted projects:

1. `mcp__plugin_flutter_flutter-ultra-build__validate_web_redirect` to check `web/index.html` base href and redirect handling.
2. `mcp__plugin_flutter_flutter-ultra-build__validate_canvaskit_vs_html_consistency` to verify renderer consistency.
3. `mcp__plugin_flutter_flutter-ultra-build__flush_service_worker` when changing web config during development.

## Signing verification

After scaffolding a release-ready project:

1. `mcp__plugin_flutter_flutter-ultra-build__verify_android_signing` to check keystore and signing config.
2. `mcp__plugin_flutter_flutter-ultra-build__verify_ios_signing` to check provisioning profiles.
3. `mcp__plugin_flutter_flutter-ultra-build__set_bundle_id` to configure the app's bundle identifier.

## Safety rules

- Always announce the file list before writing. Wait for user confirmation if more than 3 files.
- Never overwrite existing files without explicit confirmation.
- Match the existing naming convention (`snake_case` vs `camelCase`).
- Run `analyze` and surface any errors before reporting done.

## Tool reference

| Action               | Tool                                                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| Project info         | `mcp__plugin_flutter_flutter-ultra-build__project_info`                           |
| List projects        | `mcp__plugin_flutter_flutter-ultra-build__list_projects`                          |
| Add dependency       | `mcp__plugin_flutter_flutter-ultra-build__pub_add`                                |
| Remove dependency    | `mcp__plugin_flutter_flutter-ultra-build__pub_remove`                             |
| Resolve deps         | `mcp__plugin_flutter_flutter-ultra-build__pub_get`                                |
| Search pub.dev       | `mcp__plugin_flutter_flutter-ultra-build__pub_dev_search`                         |
| Format code          | `mcp__plugin_flutter_flutter-ultra-build__format`                                 |
| Analyze              | `mcp__plugin_flutter_flutter-ultra-build__analyze`                                |
| Auto-fix             | `mcp__plugin_flutter_flutter-ultra-build__fix`                                    |
| Preview fixes        | `mcp__plugin_flutter_flutter-ultra-build__fix_preview`                            |
| Build runner         | `mcp__plugin_flutter_flutter-ultra-build__start_build_runner_build`               |
| Gen l10n             | `mcp__plugin_flutter_flutter-ultra-build__flutter_gen_l10n`                       |
| Add asset            | `mcp__plugin_flutter_flutter-ultra-build__add_asset`                              |
| Validate assets      | `mcp__plugin_flutter_flutter-ultra-build__validate_assets`                        |
| Orphan assets        | `mcp__plugin_flutter_flutter-ultra-build__list_orphan_assets`                     |
| Web redirect         | `mcp__plugin_flutter_flutter-ultra-build__validate_web_redirect`                  |
| CanvasKit check      | `mcp__plugin_flutter_flutter-ultra-build__validate_canvaskit_vs_html_consistency` |
| Flush SW             | `mcp__plugin_flutter_flutter-ultra-build__flush_service_worker`                   |
| Android signing      | `mcp__plugin_flutter_flutter-ultra-build__verify_android_signing`                 |
| iOS signing          | `mcp__plugin_flutter_flutter-ultra-build__verify_ios_signing`                     |
| Set bundle ID        | `mcp__plugin_flutter_flutter-ultra-build__set_bundle_id`                          |
| Flutter doctor       | `mcp__plugin_flutter_flutter-ultra-build__flutter_doctor`                         |
| Missing translations | `mcp__plugin_flutter_flutter-ultra-build__list_missing_translations`              |

## Example

```
User: "/flutter:scaffold add an InvoiceList feature to the Invora app"

1. project_info -> detected: BLoC + GoRouter
2. Announce plan: 7 files to create (bloc, events, state, page, view, barrel, test)
3. [User confirms]
4. Create files following BLoC + GoRouter pattern
5. Add GoRoute entry to router config
6. format -> normalized
7. analyze -> 0 errors
-> "InvoiceList feature scaffolded: 7 files created, 1 file modified."
```

## See also

- `flutter-test` — write and run tests for scaffolded features
- `flutter-setup` — initial flutter-ultra plugin setup
