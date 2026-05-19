---
name: flutter-bisect
description: Automates git bisect to find the commit that introduced a bug. Flutter-aware with pub get, build_runner, and flutter_clean between commits. Use when a test passes on an older commit but fails on HEAD and you need to find exactly which commit broke it.
disable-model-invocation: true
---

# Automated Regression Finder

Pinpoints the exact commit that broke a passing test via `git bisect`, running Flutter-aware setup at each step. For diagnosing a bug you already know the source of, use `flutter-debug` instead.

## Workflow

### 1. Confirm inputs

- **Good commit**: last-known-good tag, SHA, or relative ref.
- **Bad commit**: defaults to `HEAD`.
- **Oracle type**: `unit`, `widget`, `golden`, or `patrol`.
- **Oracle selector**: test name pattern or patrol `testFilePath`.
- **Project**: `mcp__plugin_flutter_flutter-ultra-build__list_projects` if not known.
- **Has build_runner**: check for `build.yaml` in the project root.

### 2. Stash uncommitted changes

Check for dirty working tree via Bash `git status --porcelain`. If non-empty, stash with `git stash push -m "flutter-bisect-autoStash"`.

### 3. Start bisect

```bash
git bisect start --first-parent HEAD <good-commit>
```

`--first-parent` keeps the walk on the mainline.

### 4. At each bisect step

#### 4a. Get current commit info

```bash
git log -1 --format="%H %s"
```

#### 4b. Restore Flutter state

1. `mcp__plugin_flutter_flutter-ultra-build__pub_get` — always run even if pubspec.yaml looks unchanged.
   - If pub get fails (dependency conflict): mark **bad** and continue.
2. If `needs_build_runner`:
   - `mcp__plugin_flutter_flutter-ultra-build__start_build_runner_build`
   - `mcp__plugin_flutter_flutter-ultra-build__poll_build_runner_job`
   - `mcp__plugin_flutter_flutter-ultra-build__get_build_runner_result`
   - If build_runner fails: mark **bad** and continue.
3. If the commit changes Flutter SDK version (`.tool-versions`, `fvm`): `mcp__plugin_flutter_flutter-ultra-build__flutter_clean` before pub get.

#### 4c. Run the oracle

**Unit/widget oracle:**

- `mcp__plugin_flutter_flutter-ultra-build__start_run_unit_tests` (or `start_run_widget_tests`) with `testNamePattern`.
- `mcp__plugin_flutter_flutter-ultra-build__poll_run_unit_tests` (or `poll_run_widget_tests`).
- `mcp__plugin_flutter_flutter-ultra-build__get_run_unit_tests_result` (or `get_run_widget_tests_result`).
- All targeted tests pass -> **good**. Any fail -> **bad**.

**Golden oracle:**

- `mcp__plugin_flutter_flutter-ultra-build__start_run_golden_tests`
- `mcp__plugin_flutter_flutter-ultra-build__poll_run_golden_tests`
- `mcp__plugin_flutter_flutter-ultra-build__get_run_golden_tests_result`

**Patrol oracle:**

- `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_test` with `testFilePath` and `device`.
- `mcp__plugin_flutter_flutter-ultra-patrol__poll_patrol_job`.
- `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_result`.

#### 4d. Mark the commit

```bash
git bisect good   # if oracle passed
git bisect bad    # if oracle failed
```

Loop back to 4a until git prints `<sha> is the first bad commit`.

### 5. Build verification (optional)

If the regression might be a build failure rather than a test failure, also run the platform build at each step using the build server's `start_build_{platform}` -> `poll_build_{platform}_job` -> `get_build_{platform}_result` pattern. Build failure -> **bad**.

### 6. Report the first bad commit

```bash
git show --stat <sha>
git log -1 --format="%H%n%an <%ae>%n%ad%n%s%n%b" --date=iso <sha>
```

### 7. Reset and restore

```bash
git bisect reset
git stash pop  # if stash was created
```

## Edge cases

| Situation | Handling |
|-----------|----------|
| **Merge commits** | `--first-parent` avoids them. Remove the flag only if the user explicitly wants to bisect a merged branch. |
| **Uncommitted changes** | Auto-stash in step 2; restore in step 7. |
| **Submodule repo** | Confirm the user wants to bisect the outer aggregate, not the inner submodule. |
| **Flutter SDK version change** | `mcp__plugin_flutter_flutter-ultra-build__flutter_clean` before pub get. |
| **Flaky oracle** | Re-run once. If it fails again, mark bad. |
| **All commits bad** | Stop and ask the user to verify the good commit reference. |

## Tool reference

| Action | Tool |
|--------|------|
| List projects | `mcp__plugin_flutter_flutter-ultra-build__list_projects` |
| Pub get | `mcp__plugin_flutter_flutter-ultra-build__pub_get` |
| Flutter clean | `mcp__plugin_flutter_flutter-ultra-build__flutter_clean` |
| Build runner start | `mcp__plugin_flutter_flutter-ultra-build__start_build_runner_build` |
| Build runner poll | `mcp__plugin_flutter_flutter-ultra-build__poll_build_runner_job` |
| Build runner result | `mcp__plugin_flutter_flutter-ultra-build__get_build_runner_result` |
| Start unit tests | `mcp__plugin_flutter_flutter-ultra-build__start_run_unit_tests` |
| Poll unit tests | `mcp__plugin_flutter_flutter-ultra-build__poll_run_unit_tests` |
| Get unit results | `mcp__plugin_flutter_flutter-ultra-build__get_run_unit_tests_result` |
| Start widget tests | `mcp__plugin_flutter_flutter-ultra-build__start_run_widget_tests` |
| Poll widget tests | `mcp__plugin_flutter_flutter-ultra-build__poll_run_widget_tests` |
| Get widget results | `mcp__plugin_flutter_flutter-ultra-build__get_run_widget_tests_result` |
| Start golden tests | `mcp__plugin_flutter_flutter-ultra-build__start_run_golden_tests` |
| Poll golden tests | `mcp__plugin_flutter_flutter-ultra-build__poll_run_golden_tests` |
| Get golden results | `mcp__plugin_flutter_flutter-ultra-build__get_run_golden_tests_result` |
| Start patrol test | `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_test` |
| Poll patrol | `mcp__plugin_flutter_flutter-ultra-patrol__poll_patrol_job` |
| Get patrol result | `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_result` |
| Build (any platform) | `start_build_{platform}` via the build server |

## Output format

```
## Bisect Result

First bad commit: <sha>
Author:  <name> <<email>>
Date:    <iso date>
Message: <subject line>

Files changed:
<git show --stat output>

Steps taken: <N> commits tested across <M> total candidates.
```

## Example

```
User: "/flutter:bisect The InvoiceBloc test was green on v1.3.0 but fails on HEAD."

1. list_projects -> "my-app", build.yaml present -> needs_build_runner=true
2. git status -> clean, no stash needed
3. git bisect start --first-parent HEAD v1.3.0 -> "~6 steps"
4. [commit abc123] pub_get -> ok; build_runner -> ok; run_unit_tests("InvoiceBloc") -> FAIL -> bad
5. [commit def456] pub_get -> ok; build_runner -> ok; run_unit_tests -> FAIL -> bad
6. [commit ghi789] pub_get -> ok; build_runner -> ok; run_unit_tests -> PASS -> good
7. ... (3 more steps)
8. git: "pqr678 is the first bad commit" -> "refactor(billing): collapse invoice state machine"
9. git bisect reset
-> Report with commit details and changed files
```

## See also

- `flutter-test` — run the full test suite without bisecting
- `flutter-debug` — inspect live runtime state after identifying the suspect commit
