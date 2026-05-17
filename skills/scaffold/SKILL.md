---
name: scaffold
description: Scaffolding new Flutter projects or features following the conventions detected in the existing codebase. Use when starting a fresh app, adding a feature module, or generating boilerplate that should match an existing project's structure.
disable-model-invocation: true
---

# Scaffold (stub)

**Status:** scaffold stub. Implementation owner: wave-3 skills worker (see plan §8.4, §12).

This skill is opinionated and destructive (creates files), so it is **not** auto-invocable. The user must trigger it explicitly with `/flutter:scaffold`.

## Workflow

- Project mode: `flutter create` via shell with detected channel + org.
- Feature mode: read the existing structure via `mcp__flutter-ultra-build__project_info`, then create files that match.

## See also

- Plan §8.4
- Sibling skill: `setup` for plugging the plugin into an existing codebase
