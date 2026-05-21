---
name: fix-runtime-errors
description: Uses get_runtime_errors and lsp to fetch an active stack trace, locate the failing line, apply a fix, and verify resolution via hot_reload.
---

# Resolving Dart Static Analysis Errors

## Contents

- [Core Concepts & Guidelines](#core-concepts--guidelines)
- [Workflows](#workflows)
- [Examples](#examples)

## Core Concepts & Guidelines

### Type System & Soundness

Enforce Dart's sound type system to prevent runtime invalid states.

- **Method Overrides:** Maintain sound return types (covariant) and parameter types (contravariant). Never tighten a parameter type in a subclass unless explicitly marked with the `covariant` keyword.
- **Generics & Collections:** Add explicit type annotations to generic classes (e.g., `List<T>`, `Map<K, V>`). Never assign a `List<dynamic>` to a typed list.
- **Downcasting:** Avoid implicit downcasts from `dynamic`. Use explicit casts (e.g., `as List<Cat>`) when necessary, but ensure the underlying runtime type matches to prevent `TypeError` exceptions.
- **Strict Casts:** Enable `strict-casts: true` in `analysis_options.yaml` under `analyzer: language:` to force explicit casting.

### Null Safety

Eliminate static errors related to null safety by correctly managing variable initialization and nullability.

- **Modifiers:** Apply `?` for nullable types, `!` for null assertions, and `required` for named parameters that cannot be null.
- **Late Initialization:** Use the `late` keyword for non-nullable variables guaranteed to be initialized before use.
- **Wildcards:** Use the `_` wildcard variable (Dart 3.7+) for non-binding local variables or parameters.

### Error Handling

Distinguish between recoverable exceptions and unrecoverable errors.

- **Catching:** Catch `Exception` subtypes for recoverable failures.
- **Errors:** Never explicitly catch `Error` or its subtypes (e.g., `TypeError`, `ArgumentError`). Errors indicate programming bugs that must be fixed, not caught.
- **Rethrowing:** Use `rethrow` inside a `catch` block to propagate an exception while preserving its original stack trace.

## Workflows

### Workflow: Static Analysis Resolution

**Task Progress:**

- [ ] 1. Run static analyzer.
- [ ] 2. Apply automated fixes.
- [ ] 3. Resolve remaining errors manually.
- [ ] 4. Verify fixes (Feedback Loop).

**1. Run static analyzer**

```bash
dart analyze . --fatal-infos
```

**2. Apply automated fixes**

```bash
dart fix --dry-run
dart fix --apply
```

**3. Resolve remaining errors manually**

- **If Null Safety issue:** Verify if the variable can logically be null. Use `?.` or `??` if yes, `late` if initialization is guaranteed elsewhere.
- **If Type Mismatch:** Add explicit generic type annotations to the instantiation.
- **If Invalid Override:** Widen the parameter type or add `covariant`.

**4. Verify fixes (Feedback Loop)**

```bash
dart analyze .
dart test
```

## Examples

### Fixing Dynamic List Assignments

**Input (Fails):**

```dart
void printInts(List<int> a) => print(a);

void main() {
  final list = []; // Inferred as List<dynamic>
  list.add(1);
  printInts(list); // Error
}
```

**Output (Passes):**

```dart
void printInts(List<int> a) => print(a);

void main() {
  final list = <int>[]; // Explicitly typed
  list.add(1);
  printInts(list);
}
```

### Fixing Null Safety with `late`

**Input (Fails):**

```dart
class Thermometer {
  String temperature; // Error: Non-nullable must be initialized
  void read() { temperature = '20C'; }
}
```

**Output (Passes):**

```dart
class Thermometer {
  late String temperature;
  void read() { temperature = '20C'; }
}
```

## Flutter Ultra Integration

Diagnose and fix runtime errors in the live app:

- `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` — Fetch active stack traces from the running app
- `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` — Evaluate expressions in the running isolate
- `mcp__plugin_flutter_flutter-ultra-runtime__hot_reload` — Hot reload after applying fix to verify immediately
- `mcp__plugin_flutter_flutter-ultra-runtime__get_logs` — View recent log output for context

---

> **Attribution:** This skill is vendored from [dart-lang/skills](https://github.com/dart-lang/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
