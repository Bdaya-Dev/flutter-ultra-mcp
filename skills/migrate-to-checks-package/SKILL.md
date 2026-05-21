---
name: migrate-to-checks-package
description: Replace the usage of `expect` and similar functions from `package:matcher` to `package:checks` equivalents.
---

# Migrating Dart Tests to Package Checks

## Contents

- [Dependency Management](#dependency-management)
- [Syntax Migration Guidelines](#syntax-migration-guidelines)
- [Migration Workflow](#migration-workflow)
- [Examples](#examples)

## Dependency Management

- Add `package:checks` as a `dev_dependency` using `dart pub add dev:checks`.
- Remove `package:matcher` if it is explicitly listed in the `pubspec.yaml` (note: it is often transitively included by `package:test`, which is fine).
- Import `package:checks/checks.dart` in all test files undergoing migration.

## Syntax Migration Guidelines

Transition test assertions from the `package:matcher` syntax to the literate API provided by `package:checks`.

- **Basic Equality:** Replace `expect(actual, equals(expected))` with `check(actual).equals(expected)`.
- **Type Checking:** Replace `expect(actual, isA<Type>())` with `check(actual).isA<Type>()`.
- **Property Extraction:** Replace `expect(actual.property, expected)` with `check(actual).has((a) => a.property, 'property name').equals(expected)`.
- **Cascades for Multiple Checks:** Use Dart's cascade operator (`..`) to chain multiple expectations on a single subject.
- **Asynchronous Expectations:**
  - If checking a `Future`, `await` the `check` call: `await check(someFuture).completes((r) => r.equals(expected));`.
  - If checking a `Stream`, wrap it in a `StreamQueue` for multiple checks.

## Migration Workflow

- [ ] Add `package:checks` as a dev dependency.
- [ ] Identify all test files using `package:matcher` (`expect` calls).
- [ ] Import `package:checks/checks.dart` in target test files.
- [ ] Rewrite all `expect(...)` statements to `check(...)` statements.
- [ ] Run static analyzer.
- [ ] Run tests.

### Feedback Loop: Static Analysis

1. Run the analyzer on the modified test directories.
2. Review any static analysis warnings or errors.
3. Fix the warnings.
4. Repeat until zero issues.

### Feedback Loop: Test Validation

1. Run the tests.
2. If tests fail, review the failure output. `package:checks` provides detailed context.
3. Adjust the `check()` expectations or the underlying code.
4. Repeat until all tests pass.

## Examples

### Basic Assertions

**Input (`matcher`):**

```dart
expect(someList.length, 1);
expect(someString, startsWith('a'));
expect(someObject, isA<Map>());
```

**Output (`checks`):**

```dart
check(someList).length.equals(1);
check(someString).startsWith('a');
check(someObject).isA<Map>();
```

### Composed Expectations

**Input (`matcher`):**

```dart
expect('foo,bar,baz', allOf([
  contains('foo'),
  isNot(startsWith('bar')),
  endsWith('baz')
]));
```

**Output (`checks`):**

```dart
check('foo,bar,baz')
  ..contains('foo')
  ..not((s) => s.startsWith('bar'))
  ..endsWith('baz');
```

### Asynchronous Futures

**Input (`matcher`):**

```dart
expect(Future.value(10), completion(equals(10)));
expect(Future.error('oh no'), throwsA(equals('oh no')));
```

**Output (`checks`):**

```dart
await check(Future.value(10)).completes((it) => it.equals(10));
await check(Future.error('oh no')).throws<String>().equals('oh no');
```

## Flutter Ultra Integration

Validate the migration with static analysis and tests:

- `mcp__plugin_flutter_flutter-ultra-build__analyze` — Check for type errors after migration
- `mcp__plugin_flutter_flutter-ultra-build__fix` — Apply automated fixes for simple migrations
- `mcp__plugin_flutter_flutter-ultra-build__start_run_unit_tests` — Run tests to verify migration didn't break assertions

---

> **Attribution:** This skill is vendored from [dart-lang/skills](https://github.com/dart-lang/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
