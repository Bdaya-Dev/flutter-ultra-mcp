# flutter-ultra-mcp

[![npm](https://img.shields.io/npm/v/@bdayadev/flutter-ultra-mcp)](https://www.npmjs.com/package/@bdayadev/flutter-ultra-mcp)
[![pub.dev](https://img.shields.io/pub/v/ultra_flutter)](https://pub.dev/packages/ultra_flutter)
[![CI](https://github.com/Bdaya-Dev/flutter-ultra-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Bdaya-Dev/flutter-ultra-mcp/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Bdaya-Dev/flutter-ultra-mcp)](LICENSE)

A Claude Code plugin that gives your AI agent full control over Flutter apps across all platforms. 8 isolated MCP servers, 295 tools, 2 Dart packages, and 31 built-in skills — installed with a single command.

## Why

A monolithic Flutter MCP server crashes badly: a malformed `pubspec.yaml` or a flaky AT-SPI binding takes down hot reload, gestures, browser, **and** native automation in one shot. flutter-ultra-mcp splits the surface across 8 independent processes so a Playwright timeout can't kill your hot reload, and a broken pubspec can't block your running test.

## Quick start

```bash
# 1. Install the Claude Code plugin
/plugin install Bdaya-Dev/flutter-ultra-mcp

# 2. Add the Dart package to your Flutter project
flutter pub add ultra_flutter

# 3. Initialize the binding in main.dart
```

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

void main() {
  if (!kReleaseMode) {
    UltraFlutterBinding.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}
```

Start a debug session (`flutter run -d chrome`), open Claude Code, and ask it to take a screenshot or run `/flutter:tour`.

## Architecture

Each server runs as its own Node.js process. Crash isolation means a bug in one server cannot affect the others. Servers share session state through small JSON files on disk — if a server restarts, it picks up where it left off.

| Server                         |   Tools | What it does                                                                                                             |
| ------------------------------ | ------: | ------------------------------------------------------------------------------------------------------------------------ |
| `flutter-ultra-build`          |      97 | Pub dependencies, code generation, analysis, formatting, tests, platform builds, l10n, assets, signing, project creation |
| `flutter-ultra-runtime`        |      56 | Attach to debug sessions, widget tree, VM service method calls, performance profiling, design audit, logs, HTTP capture  |
| `flutter-ultra-browser`        |      35 | Playwright web automation — network mocking, offline sim, OAuth, drag-drop, dialogs, tracing, console, storage           |
| `flutter-ultra-native-mobile`  |      43 | Android + iOS — a11y tree, permissions, file picker, notifications, share sheet, CCT/SVC, GPS, deep links, app mgmt      |
| `flutter-ultra-gesture`        |      19 | Tap, swipe, scroll, text input, multi-touch W3C Actions, screenshots, screencast via `ultra_flutter` mixin               |
| `flutter-ultra-patrol`         |      31 | Orchestrate `patrol_cli` for E2E tests across web, Android, and iOS — run, poll, record, screenshot                      |
| `flutter-ultra-native-desktop` |       9 | Windows (UIA), macOS (Accessibility), Linux (AT-SPI) — window listing, a11y tree, clicks, file dialogs, remote SSH       |
| `flutter-ultra-devtools`       |       5 | Live MCP activity panel inside Flutter DevTools — sessions, tool calls, errors, screenshot grid                          |
| **Total**                      | **295** |                                                                                                                          |

See [docs/architecture.md](docs/architecture.md) for the full design.

## Skills

Skills teach Claude the correct tool call sequences for common workflows. Invoke them with `/flutter:<name>`.

### Workflow skills (12)

| Skill                    | Description                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `/flutter:setup`         | One-command setup of flutter-ultra in an existing codebase                                   |
| `/flutter:tour`          | Route-by-route screenshot sweep for visual documentation and regression checks               |
| `/flutter:drive`         | Multi-step user flow automation (login, checkout, onboarding)                                |
| `/flutter:debug`         | Attach to a running app and triage errors from stack trace, widget tree, and network traffic |
| `/flutter:test`          | Orchestrate unit, widget, golden, and patrol E2E tests with focused reporting                |
| `/flutter:bisect`        | Automated `git bisect` using test results as the oracle                                      |
| `/flutter:scaffold`      | Generate project boilerplate following conventions detected in the existing codebase         |
| `/flutter:design-audit`  | Audit the live app for accessibility, layout, spacing, and design-system conformance         |
| `/flutter:design-verify` | Compare the running app against Figma mockups for design-implementation drift                |
| `/flutter:figma-push`    | Push Flutter web app UI to Figma as editable layers from live screenshots                    |
| `/flutter:record-demo`   | Record a video or GIF demo of an app flow (web browser or native device)                     |
| `/flutter:devtools`      | Wire up and use the DevTools panel for live MCP activity inspection                          |

### Teaching skills (19 — vendored from [flutter/skills](https://github.com/flutter/skills) + [dart-lang/skills](https://github.com/dart-lang/skills))

Each teaching skill includes a **Flutter Ultra Integration** section mapping to the MCP tools that execute the workflow it teaches.

| Skill                                        | Description                                                          |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `/flutter:add-integration-test`              | Configure Flutter Driver and write integration tests                 |
| `/flutter:add-widget-preview`                | Add `@Preview` annotations for real-time widget previewing           |
| `/flutter:add-widget-test`                   | Write component-level tests with `WidgetTester`                      |
| `/flutter:apply-architecture-best-practices` | Structure apps with MVVM + Repository layered architecture           |
| `/flutter:build-responsive-layout`           | Build adaptive layouts with `LayoutBuilder` and `MediaQuery`         |
| `/flutter:fix-layout-issues`                 | Diagnose and fix RenderFlex overflow and unbounded constraint errors |
| `/flutter:implement-json-serialization`      | Manual JSON mapping with `fromJson`/`toJson`                         |
| `/flutter:setup-declarative-routing`         | Configure `go_router` with deep linking and nested navigation        |
| `/flutter:setup-localization`                | Set up `flutter_localizations` with ARB files                        |
| `/flutter:use-http-package`                  | Execute HTTP requests with the `http` package                        |
| `/flutter:add-unit-test`                     | Write unit tests with `package:test`                                 |
| `/flutter:build-cli-app`                     | Build Dart CLI apps with argument parsing and compilation            |
| `/flutter:collect-coverage`                  | Collect LCOV coverage reports                                        |
| `/flutter:fix-runtime-errors`                | Resolve type system, null safety, and static analysis errors         |
| `/flutter:generate-test-mocks`               | Generate mock objects with `package:mockito` + `build_runner`        |
| `/flutter:migrate-to-checks-package`         | Migrate from `expect`/`matcher` to `package:checks`                  |
| `/flutter:resolve-package-conflicts`         | Fix `pub get` version conflicts                                      |
| `/flutter:run-static-analysis`               | Run `dart analyze` and `dart fix`                                    |
| `/flutter:use-pattern-matching`              | Apply switch expressions and Dart 3 pattern matching                 |

## Installation

### Plugin (required)

```bash
/plugin install Bdaya-Dev/flutter-ultra-mcp
```

This registers all 8 MCP servers and 31 skills automatically. No manual configuration needed.

### Dart package (required for gesture and screencast tools)

Add `ultra_flutter` to your app's **dependencies** (not dev_dependencies — the binding must be present in the compiled app):

```bash
flutter pub add ultra_flutter
```

Then initialize the binding in your `main.dart`:

```dart
import 'package:flutter/foundation.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

void main() {
  if (!kReleaseMode) {
    UltraFlutterBinding.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}
```

#### Composing with Sentry

`UltraFlutterBinding` is a mixin on `WidgetsBinding`, not a subclass. It composes with other binding mixins like Sentry's:

```dart
// ignore: implementation_imports
import 'package:sentry_flutter/src/binding_wrapper.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

class AppBinding extends WidgetsFlutterBinding
    with SentryWidgetsBindingMixin, UltraFlutterBinding {}

void main() {
  if (!kReleaseMode) {
    AppBinding();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  // SentryFlutter.init(...) then runApp(...)
}
```

### DevTools extension (optional)

For the live activity panel inside Flutter DevTools:

```bash
flutter pub add ultra_flutter_devtools
```

This adds a DevTools tab showing active sessions, recent tool calls, errors, and a screenshot grid.

## Requirements

| Dependency  | Version   | Required                                      |
| ----------- | --------- | --------------------------------------------- |
| Flutter SDK | >= 3.27.0 | Yes                                           |
| Dart SDK    | >= 3.6.0  | Yes                                           |
| Node.js     | >= 20     | Yes (plugin runtime)                          |
| Claude Code | latest    | Yes                                           |
| `ffmpeg`    | any       | Optional — video/GIF recording and conversion |
| Android SDK | any       | Optional — native mobile tools for Android    |
| Xcode       | any       | Optional — native mobile tools for iOS        |

## Platform support

| Capability           | Web | Android |      iOS       |     Windows      |     macOS      |     Linux      |
| -------------------- | :-: | :-----: | :------------: | :--------------: | :------------: | :------------: |
| Build                |  x  |    x    | x (macOS only) | x (Windows only) | x (macOS only) | x (Linux only) |
| Runtime attach       |  x  |    x    |       x        |        x         |       x        |       x        |
| Gesture / screenshot |  x  |    x    |       x        |        x         |       x        |       x        |
| Browser automation   |  x  |    -    |       -        |        -         |       -        |       -        |
| Native UI automation |  -  |    x    |       x        |        x         |       x        |       x        |
| Patrol E2E tests     |  x  |    x    |       x        |        -         |       -        |       -        |
| DevTools panel       |  x  |    x    |       x        |        x         |       x        |       x        |

## Dart packages

### [`ultra_flutter`](https://pub.dev/packages/ultra_flutter)

In-app binding mixin that registers `ext.flutter.ultra.*` VM service extensions for gesture dispatch, screenshots, screencast streaming, widget matching, and log collection. The mixin form (`on WidgetsBinding`) composes with any existing binding — Sentry, Firebase, or custom subclasses.

**SDK requirements:** Flutter >= 3.27.0, Dart >= 3.6.0

### [`ultra_flutter_devtools`](https://pub.dev/packages/ultra_flutter_devtools)

Flutter DevTools extension that renders a live activity panel: active MCP sessions, recent tool calls with timing, error log, and a screenshot grid from tour/drive runs.

**SDK requirements:** Flutter >= 3.24.0, Dart >= 3.5.0

## Development

```bash
git clone https://github.com/Bdaya-Dev/flutter-ultra-mcp.git
cd flutter-ultra-mcp
npm install
npm run build
npm test
```

The repo is a monorepo managed by [Turborepo](https://turbo.build/). Each server is a separate package under `packages/`. Dart packages live under `dart/`. Shared TypeScript utilities live under `shared/`.

```
packages/
  flutter-ultra-build/        # pubspec, codegen, tests, builds
  flutter-ultra-runtime/       # VM service, widget tree, performance
  flutter-ultra-gesture/       # tap, scroll, screenshot via mixin
  flutter-ultra-browser/       # Playwright web automation
  flutter-ultra-native-mobile/ # Android + iOS native
  flutter-ultra-native-desktop/# Windows + macOS + Linux native
  flutter-ultra-patrol/        # patrol_cli orchestration
  flutter-ultra-devtools/      # DevTools panel server
shared/
  mcp-runtime/                 # Shared server base, state, watchdog
dart/
  ultra_flutter/               # In-app binding mixin (pub.dev)
  ultra_flutter_devtools/      # DevTools extension (pub.dev)
skills/                        # Skill markdown files for Claude
examples/
  counter-app/                 # Minimal example
  oidc-app/                    # OIDC auth flow example
```

### Available scripts

| Command                 | What it does                     |
| ----------------------- | -------------------------------- |
| `npm run build`         | Build all packages via Turborepo |
| `npm run test`          | Run all unit tests               |
| `npm run lint`          | Lint all packages                |
| `npm run typecheck`     | TypeScript type checking         |
| `npm run format`        | Format all files with Prettier   |
| `npm run format:check`  | Check formatting without writing |
| `npm run test:e2e:web`  | End-to-end tests (web)           |
| `npm run test:e2e:oidc` | End-to-end tests (OIDC flow)     |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, commit message format, and local test instructions.

## Security

See [SECURITY.md](SECURITY.md) for the loopback-only network design and vulnerability reporting process.

## License

Apache-2.0 — see [LICENSE](LICENSE).
