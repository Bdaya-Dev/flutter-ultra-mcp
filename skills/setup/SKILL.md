---
name: setup
description: Bootstrapping flutter-ultra-mcp into an existing Flutter codebase end-to-end. Use when the user wants the plugin enabled for the first time on a project, or when re-running after a clean install. Idempotent.
disable-model-invocation: true
---

# Setup (stub)

**Status:** scaffold stub. Implementation owner: wave-3 skills worker (see plan §8.7, §12).

User-triggered only — patches pubspec, entry points, and `.vscode/launch.json`.

## Workflow (target)

1. Detect project layout via `mcp__flutter-ultra-build__project_info` (entry points, existing bindings, Sentry usage, patrol).
2. Add `ultra_flutter` to `dev_dependencies`; if Sentry detected, show the direct `// ignore: implementation_imports` binding pattern.
3. Patch entry point(s) with AST-aware edits to mix in `UltraFlutterBinding` under `kDebugMode`.
4. Optional: add a launch.json profile pre-applying dart-defines for session discovery.
5. Detect existing patrol setup and offer the `run_patrol_web` wrapper.
6. Generate per-project `.flutter-ultra.config.yaml`.
7. Run a smoke launch + screenshot + detach.
8. Emit `SETUP-REPORT.md` at project root.

## See also

- Plan §8.7
