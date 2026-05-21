---
name: resolve-package-conflicts
description: Workflow for fixing package version conflicts. Use this when `pub get` fails due to incompatible package versions.
---

# Managing Dart Dependencies

## Contents

- [Core Concepts](#core-concepts)
- [Version Constraints](#version-constraints)
- [Workflow: Auditing Dependencies](#workflow-auditing-dependencies)
- [Workflow: Upgrading Dependencies](#workflow-upgrading-dependencies)
- [Workflow: Resolving Version Conflicts](#workflow-resolving-version-conflicts)
- [Examples](#examples)

## Core Concepts

Dart enforces a strict single-version rule for dependencies: a project and all its transitive dependencies must resolve to a single, shared version of any given package.

Understand the output columns of `dart pub outdated`:

- **Current:** The version currently recorded in `pubspec.lock`.
- **Upgradable:** The latest version allowed by the constraints in `pubspec.yaml`. `dart pub upgrade` resolves to this.
- **Resolvable:** The absolute latest version that can be resolved when factoring in all other dependencies.
- **Latest:** The latest published version of the package (excluding prereleases).

## Version Constraints

- **Use Caret Syntax:** Always use caret syntax (e.g., `^1.2.3`) for dependencies.
- **Tighten Dev Dependencies:** Set the lower bound of `dev_dependencies` to the exact version currently used.
- **Enforce Lockfiles in CI:** Use `dart pub get --enforce-lockfile` in CI/CD pipelines.

## Workflow: Auditing Dependencies

**Task Progress:**

- [ ] Run `dart pub outdated`.
- [ ] Review the **Upgradable** column.
- [ ] Review the **Resolvable** column.
- [ ] Identify any packages marked as retracted or discontinued.

## Workflow: Upgrading Dependencies

**Task Progress:**

- [ ] **If updating to "Upgradable" versions:**
  - [ ] Run `dart pub upgrade`.
  - [ ] Run `dart pub upgrade --tighten` to update lower bounds.
- [ ] **If updating to "Resolvable" versions (Major updates):**
  - [ ] Manually edit `pubspec.yaml` to bump the version constraint.
  - [ ] Run `dart pub upgrade` to resolve the new constraints.
- [ ] **Feedback Loop:**
  - [ ] Run `dart analyze` -> review errors -> fix breaking API changes.
  - [ ] Run `dart test` -> review failures -> fix regressions.

## Workflow: Resolving Version Conflicts

**NEVER** delete the entire `pubspec.lock` file and run `dart pub get`. This causes uncontrolled upgrades across the entire dependency graph.

**Task Progress:**

- [ ] Open `pubspec.lock`.
- [ ] Locate the specific YAML block for the conflicting or retracted package.
- [ ] Delete ONLY that package's entry from the lockfile.
- [ ] Run `dart pub get` to fetch the newest compatible version.
- [ ] **Feedback Loop:**
  - [ ] Run `dart pub deps` -> verify the dependency graph resolves correctly.
  - [ ] If resolution fails, identify the transitive dependency causing the lock, update its constraint in `pubspec.yaml`, and retry.

## Examples

### Tightening Constraints

**Input (`pubspec.yaml`):**

```yaml
dependencies:
  http: ^0.13.0
```

**Command:**

```bash
dart pub upgrade --tighten http
```

**Output (`pubspec.yaml`):**

```yaml
dependencies:
  http: ^0.13.5
```

### Surgical Lockfile Removal

If `package_a` is retracted or locked in a conflict, remove only its block from `pubspec.lock`. Leave all other entries untouched. Run `dart pub get`.

## Flutter Ultra Integration

Investigate and resolve dependency conflicts:

- `mcp__plugin_flutter_flutter-ultra-build__pub_get` — Run pub get to see the current resolution state
- `mcp__plugin_flutter_flutter-ultra-build__pub_deps` — View the full dependency tree
- `mcp__plugin_flutter_flutter-ultra-build__pub_outdated` — Check which packages are outdated
- `mcp__plugin_flutter_flutter-ultra-build__pub_upgrade` — Attempt upgrade to resolve conflicts

---

> **Attribution:** This skill is vendored from [dart-lang/skills](https://github.com/dart-lang/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
