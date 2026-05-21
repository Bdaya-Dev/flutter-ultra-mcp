---
name: run-static-analysis
description: Execute `dart analyze` to identify warnings and errors, and use `dart fix --apply` to automatically resolve mechanical lint issues. Use during development to ensure code quality and before committing changes.
---

# Analyzing and Fixing Dart Code

## Contents

- [Analysis Configuration](#analysis-configuration)
- [Diagnostic Suppression](#diagnostic-suppression)
- [Workflow: Executing Static Analysis](#workflow-executing-static-analysis)
- [Workflow: Applying Automated Fixes](#workflow-applying-automated-fixes)
- [Examples](#examples)

## Analysis Configuration

Configure the Dart analyzer using the `analysis_options.yaml` file at the package root.

- **Base Configuration:** Include a standard rule set (e.g., `package:lints/recommended.yaml` or `package:flutter_lints/flutter.yaml`).
- **Strict Type Checks:** Enable `strict-casts: true`, `strict-inference: true`, and `strict-raw-types: true` under `analyzer: language:`.
- **Linter Rules:** Enable or disable specific rules under `linter: rules:`. Do not mix list and map syntax in the same `rules` block.
- **Formatter Configuration:** Configure `dart format` behavior under the `formatter:` node. Set `page_width` and `trailing_commas`.

## Diagnostic Suppression

- **File-level Exclusion:** Use `analyzer: exclude:` with glob patterns (e.g., `**/*.g.dart`).
- **File-level Suppression:** Add `// ignore_for_file: <diagnostic_code>` at the top of a file.
- **Line-level Suppression:** Add `// ignore: <diagnostic_code>` on the line above.

## Workflow: Executing Static Analysis

**Task Progress:**

- [ ] 1. Verify `analysis_options.yaml` exists at the project root.
- [ ] 2. Run the analyzer: `dart analyze <target_directory>`.
- [ ] 3. Review the diagnostic output.
- [ ] 4. If info-level issues must be treated as failures, append `--fatal-infos`.
- [ ] 5. Resolve reported errors manually or proceed to Automated Fixes.

## Workflow: Applying Automated Fixes

**Task Progress:**

- [ ] 1. Preview proposed changes: `dart fix --dry-run`.
- [ ] 2. Review the proposed fixes.
- [ ] 3. Apply the fixes: `dart fix --apply`.
- [ ] 4. Format the modified code: `dart format .`.
- [ ] 5. Run static analysis again to verify all diagnostics are resolved.

## Examples

### Comprehensive `analysis_options.yaml`

```yaml
include: package:flutter_lints/recommended.yaml

analyzer:
  exclude:
    - '**/*.g.dart'
    - 'lib/generated/**'
  language:
    strict-casts: true
    strict-inference: true
    strict-raw-types: true
  errors:
    todo: ignore
    invalid_assignment: warning
    missing_return: error

linter:
  rules:
    avoid_shadowing_type_parameters: false
    await_only_futures: true
    use_super_parameters: true

formatter:
  page_width: 100
  trailing_commas: preserve
```

### Inline Diagnostic Suppression

```dart
// ignore_for_file: unused_local_variable, dead_code

void processData() {
  // ignore: invalid_assignment
  int x = '';

  const y = 10; // ignore: constant_identifier_names
}
```

## Flutter Ultra Integration

Run analysis and auto-fix via flutter-ultra tools:

- `mcp__plugin_flutter_flutter-ultra-build__analyze` — Run dart analyze with full diagnostics
- `mcp__plugin_flutter_flutter-ultra-build__fix` — Apply dart fix --apply for automated lint fixes
- `mcp__plugin_flutter_flutter-ultra-build__fix_preview` — Preview fixes before applying
- `mcp__plugin_flutter_flutter-ultra-build__format` — Format code after fixes

---

> **Attribution:** This skill is vendored from [dart-lang/skills](https://github.com/dart-lang/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
