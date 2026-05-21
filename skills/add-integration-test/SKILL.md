---
name: add-integration-test
description: Configures Flutter Driver for app interaction and converts MCP actions into permanent integration tests. Use when adding integration testing to a project, exploring UI components via MCP, or automating user flows with the integration_test package.
---

# Implementing Flutter Integration Tests

## Contents

- [Project Setup and Dependencies](#project-setup-and-dependencies)
- [Interactive Exploration via MCP](#interactive-exploration-via-mcp)
- [Test Authoring Guidelines](#test-authoring-guidelines)
- [Execution and Profiling](#execution-and-profiling)
- [Workflow: End-to-End Integration Testing](#workflow-end-to-end-integration-testing)
- [Examples](#examples)

## Project Setup and Dependencies

Configure the project to support integration testing and Flutter Driver extensions.

1. Add required development dependencies to `pubspec.yaml`:
   ```bash
   flutter pub add 'dev:integration_test:{"sdk":"flutter"}'
   flutter pub add 'dev:flutter_test:{"sdk":"flutter"}'
   ```
2. Enable the Flutter Driver extension in your application entry point (typically `lib/main.dart` or a dedicated `lib/main_test.dart`):
   - Import `package:flutter_driver/driver_extension.dart`.
   - Call `enableFlutterDriverExtension();` before `runApp()`.
3. Add `Key` parameters (e.g., `ValueKey('login_button')`) to critical widgets for reliable targeting.

## Interactive Exploration via MCP

Use MCP tools to interactively explore and manipulate the application state before writing static tests.

- **Launch**: Execute `launch_app` with `target: "lib/main_test.dart"` to start the application and acquire the DTD URI.
- **Inspect**: Execute `get_widget_tree` to discover available `Key`s, `Text` nodes, and widget `Type`s.
- **Interact**: Execute `tap`, `enter_text`, and `scroll` to simulate user flows.
- **Wait**: Always execute `waitFor` or verify state with `get_health` when navigating or triggering animations.
- **Troubleshoot Unmounted Widgets**: If a widget is not found, it may be lazily loaded. Execute `scroll` or `scrollIntoView` to force the widget to mount.

## Test Authoring Guidelines

Structure integration tests using the `flutter_test` API paradigm.

- Create a dedicated `integration_test/` directory at the project root.
- Name all test files using the `<name>_test.dart` convention.
- Initialize the binding: `IntegrationTestWidgetsFlutterBinding.ensureInitialized();`
- Load the application UI: `await tester.pumpWidget(MyApp());`
- Trigger frames: `await tester.pumpAndSettle();` after interactions.
- Assert visibility: `expect(find.byKey(ValueKey('foo')), findsOneWidget);`
- Scroll to off-screen widgets: `await tester.scrollUntilVisible(itemFinder, 500.0, scrollable: listFinder);`

## Execution and Profiling

Execute tests using the `flutter drive` command. Require a host driver script at `test_driver/integration_test.dart`.

- **Chrome:** Launch `chromedriver --port=4444`, then: `flutter drive --driver=test_driver/integration_test.dart --target=integration_test/app_test.dart -d chrome`
- **Headless web:** Run with `-d web-server`.
- **Android (Local):** `flutter drive --driver=test_driver/integration_test.dart --target=integration_test/app_test.dart`

## Workflow: End-to-End Integration Testing

- [ ] **Setup**
  - [ ] Add `integration_test` and `flutter_test` to `pubspec.yaml`.
  - [ ] Inject `enableFlutterDriverExtension()` into the app entry point.
  - [ ] Assign `ValueKey`s to target widgets.
- [ ] **Exploration**
  - [ ] Run `launch_app` via MCP.
  - [ ] Map the widget tree using `get_widget_tree`.
  - [ ] Validate interaction paths using MCP tools (`tap`, `enter_text`).
- [ ] **Authoring**
  - [ ] Create `integration_test/app_test.dart`.
  - [ ] Write test cases using `WidgetTester` APIs.
  - [ ] Create `test_driver/integration_test.dart` with `integrationDriver()`.
- [ ] **Execution & Feedback Loop**
  - [ ] Run `flutter drive`.
  - [ ] Review output -> fix `PumpAndSettleTimedOutException` or missing widget issues -> re-run.

## Examples

### Standard Integration Test

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:my_app/main.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('End-to-end test', () {
    testWidgets('tap on the floating action button, verify counter', (tester) async {
      await tester.pumpWidget(const MyApp());
      expect(find.text('0'), findsOneWidget);

      final fab = find.byKey(const ValueKey('increment'));
      await tester.tap(fab);
      await tester.pumpAndSettle();

      expect(find.text('1'), findsOneWidget);
    });
  });
}
```

### Host Driver Script

```dart
import 'package:integration_test/integration_test_driver.dart';

Future<void> main() => integrationDriver();
```

## Flutter Ultra Integration

After writing the integration test, use these tools to launch the app and verify it:

- `mcp__plugin_flutter_flutter-ultra-runtime__launch_app` — Launch the app with the integration test target
- `mcp__plugin_flutter_flutter-ultra-runtime__attach` — Attach to the running app's VM Service
- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — Capture screenshots during test verification
- `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` — Inspect the widget tree to verify test assertions

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
