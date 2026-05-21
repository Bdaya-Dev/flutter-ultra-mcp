---
name: add-widget-test
description: Implement a component-level test using `WidgetTester` to verify UI rendering and user interactions (tapping, scrolling, entering text). Use when validating that a specific widget displays correct data and responds to events as expected.
---

# Writing Flutter Widget Tests

## Contents

- [Setup & Configuration](#setup--configuration)
- [Core Components](#core-components)
- [Workflow: Implementing a Widget Test](#workflow-implementing-a-widget-test)
- [Interaction & State Management](#interaction--state-management)
- [Examples](#examples)

## Setup & Configuration

1. Add `flutter_test` to `dev_dependencies` in `pubspec.yaml`.
2. Place all test files in `test/` at the project root.
3. Suffix all test file names with `_test.dart`.

## Core Components

- **`WidgetTester`**: Primary interface for building and interacting with widgets. Provided by `testWidgets()`.
- **`Finder`**: Locates widgets (e.g., `find.text('Submit')`, `find.byType(TextField)`, `find.byKey(Key('submit_btn'))`).
- **`Matcher`**: Verifies presence or state (e.g., `findsOneWidget`, `findsNothing`, `findsNWidgets(2)`).

## Workflow: Implementing a Widget Test

### Task Progress

- [ ] **Step 1:** Define the test with `testWidgets('description', (WidgetTester tester) async { ... })`.
- [ ] **Step 2:** Build the widget with `await tester.pumpWidget(MyWidget())`. Wrap in `MaterialApp` if needed.
- [ ] **Step 3:** Locate elements with `Finder` objects.
- [ ] **Step 4:** Verify initial state with `expect(finder, matcher)`.
- [ ] **Step 5:** Simulate interactions (e.g., `await tester.tap(buttonFinder)`).
- [ ] **Step 6:** Rebuild the tree with `await tester.pump()` or `await tester.pumpAndSettle()`.
- [ ] **Step 7:** Verify updated state with `expect()`.
- [ ] **Step 8:** Run with `flutter test test/your_test_file_test.dart`.
- [ ] **Step 9:** Feedback Loop: Review output -> fix assertions -> re-run.

## Interaction & State Management

- **Static rendering:** `pumpWidget()` once, then immediately assert.
- **Standard state changes (button taps):** `tester.tap()` then `tester.pump()`.
- **Animations/transitions:** Trigger the action then `tester.pumpAndSettle()`.
- **Text input:** `await tester.enterText(textFieldFinder, 'Input string')`.
- **Long lists:** `await tester.scrollUntilVisible(itemFinder, 500.0, scrollable: listFinder)`.

## Examples

### TodoList Widget Test

**Target Widget (`lib/todo_list.dart`):**

```dart
import 'package:flutter/material.dart';

class TodoList extends StatefulWidget {
  const TodoList({super.key});
  @override
  State<TodoList> createState() => _TodoListState();
}

class _TodoListState extends State<TodoList> {
  final todos = <String>[];
  final controller = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Column(
          children: [
            TextField(controller: controller),
            Expanded(
              child: ListView.builder(
                itemCount: todos.length,
                itemBuilder: (context, index) {
                  final todo = todos[index];
                  return Dismissible(
                    key: Key('$todo$index'),
                    onDismissed: (_) => setState(() => todos.removeAt(index)),
                    child: ListTile(title: Text(todo)),
                  );
                },
              ),
            ),
          ],
        ),
        floatingActionButton: FloatingActionButton(
          onPressed: () {
            setState(() {
              todos.add(controller.text);
              controller.clear();
            });
          },
          child: const Icon(Icons.add),
        ),
      ),
    );
  }
}
```

**Test (`test/todo_list_test.dart`):**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_app/todo_list.dart';

void main() {
  testWidgets('Add and remove a todo item', (WidgetTester tester) async {
    await tester.pumpWidget(const TodoList());
    expect(find.byType(ListTile), findsNothing);

    await tester.enterText(find.byType(TextField), 'Buy groceries');
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pump();
    expect(find.text('Buy groceries'), findsOneWidget);

    await tester.drag(find.byType(Dismissible), const Offset(500, 0));
    await tester.pumpAndSettle();
    expect(find.text('Buy groceries'), findsNothing);
  });
}
```

## Flutter Ultra Integration

After writing the widget test, run and validate it with these tools:

- `mcp__plugin_flutter_flutter-ultra-build__start_run_widget_tests` — Execute widget tests (supports `testNamePattern` to scope)
- `mcp__plugin_flutter_flutter-ultra-build__poll_run_widget_tests` — Monitor test progress until completion
- `mcp__plugin_flutter_flutter-ultra-build__get_run_widget_tests_result` — Get detailed results: passed, failed, skipped, per-failure info
- `mcp__plugin_flutter_flutter-ultra-build__analyze` — Static analysis before running tests

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
