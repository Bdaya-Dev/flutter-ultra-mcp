---
name: test
description: Orchestrating Flutter unit, widget, and patrol E2E tests with focused reporting. Use when the user asks to run tests, validate a fix, or check coverage on a Flutter project.
---

# Test (stub)

**Status:** scaffold stub. Implementation owner: wave-3 skills worker (see plan §8.5, §12).

## Workflow

- `mcp__flutter-ultra-build__analyze` first; fail fast on lint errors.
- `mcp__flutter-ultra-build__run_unit_tests` / `run_widget_tests` per the input pattern.
- `mcp__flutter-ultra-patrol__*` for E2E.
- Report failures with file:line + a screenshot snapshot when available.

## See also

- Plan §8.5
