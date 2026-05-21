---
name: use-pattern-matching
description: Use switch expressions and pattern matching where appropriate
---

# Implementing Dart Patterns

## Contents

- [Pattern Selection Strategy](#pattern-selection-strategy)
- [Switch Statements vs. Expressions](#switch-statements-vs-expressions)
- [Core Pattern Implementations](#core-pattern-implementations)
- [Workflows](#workflows)
- [Examples](#examples)

## Pattern Selection Strategy

- **If validating and extracting from deserialized data (e.g., JSON):** Use Map and List patterns.
- **If handling multiple return values:** Use Record patterns.
- **If executing type-specific behavior (Algebraic Data Types):** Use Object patterns with `sealed` classes.
- **If matching numeric ranges or conditions:** Use Relational and Logical-and patterns.
- **If multiple cases share logic:** Use Logical-or (`||`) patterns.
- **If ignoring specific values:** Use the Wildcard pattern (`_`).

## Switch Statements vs. Expressions

- **If producing a value:** Use a **switch expression**. Syntax: `switch (value) { pattern => expression, }`. Must be exhaustive.
- **If executing statements or side effects:** Use a **switch statement**. Empty cases fall through. Non-empty cases implicitly break.

## Core Pattern Implementations

- **Logical-or (`||`):** Both branches must define the exact same set of variables.
- **Logical-and (`&&`):** Branches must _not_ define overlapping variables.
- **Relational:** `==`, `!=`, `<`, `>`, `<=`, `>=` followed by a constant expression.
- **Cast (`as`):** Throws if the value does not match the type.
- **Null-check (`?`):** Fails the match if the value is null.
- **Null-assert (`!`):** Throws if the value is null.
- **Variable:** `var name` or `Type name`. Binds the matched value.
- **Wildcard (`_`):** Matches any value and discards it.
- **List:** `[pattern1, pattern2]`. Matches lists of exact length unless a Rest element (`...`) is used.
- **Map:** `{"key": pattern}`. Matches maps containing the specified keys.
- **Record:** `(pattern1, named: pattern2)`. Use `:var name` to infer the getter name.
- **Object:** `ClassName(field: pattern)`. Use `:var field` to infer the getter name.

## Workflows

### Task Progress: Implementing Pattern Matching

- [ ] Identify the data structure being evaluated.
- [ ] Select the appropriate switch construct.
- [ ] Define the required patterns.
- [ ] Extract required data using Variable patterns.
- [ ] Apply Guard clauses (`when condition`) for logic that cannot be expressed via patterns.
- [ ] Handle unmatched cases using a Wildcard (`_`) or `default`.
- [ ] Run exhaustiveness validator.

### Feedback Loop: Exhaustiveness Checking

1. Execute `dart analyze`.
2. Look for "The type 'X' is not exhaustively matched" errors.
3. Add the missing Object patterns for unhandled subtypes, or add a Wildcard case.

## Examples

### JSON Validation and Destructuring

```dart
var data = {
  'user': ['Lily', 13],
};

if (data case {'user': [String name, int age]}) {
  print('User $name is $age years old.');
} else {
  print('Invalid JSON structure.');
}
```

### Algebraic Data Types (Sealed Classes)

```dart
sealed class Shape {}

class Square implements Shape {
  final double length;
  Square(this.length);
}

class Circle implements Shape {
  final double radius;
  Circle(this.radius);
}

double calculateArea(Shape shape) => switch (shape) {
  Square(length: var l) => l * l,
  Circle(:var radius)   => math.pi * radius * radius,
};
```

### Variable Swapping and Destructuring

```dart
var (a, b) = ('left', 'right');
(b, a) = (a, b); // Swap values

var (name, age) = getUserInfo();
```

### Guard Clauses and Logical-or

```dart
switch (shape) {
  case Square(size: var s) || Circle(size: var s) when s > 0:
    print('Valid symmetric shape with size $s');
  case Square() || Circle():
    print('Invalid or empty shape');
  default:
    print('Unknown shape');
}
```

## Flutter Ultra Integration

Validate pattern matching usage with analysis:

- `mcp__plugin_flutter_flutter-ultra-build__analyze` — Check for exhaustiveness and type errors
- `mcp__plugin_flutter_flutter-ultra-build__fix` — Apply automated pattern matching migrations

---

> **Attribution:** This skill is vendored from [dart-lang/skills](https://github.com/dart-lang/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
