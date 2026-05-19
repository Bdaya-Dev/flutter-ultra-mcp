---
name: flutter-bisect
description: Automate git bisect to find the commit that introduced a bug. Flutter-aware: runs pub get + build_runner between commits. Use when a test passes on an older commit but fails on HEAD and you need to find exactly which commit broke it.
disable-model-invocation: true
---

# flutter-bisect — Automated Regression Finder

## When to use

Use this skill when a test (unit, widget, or patrol E2E) passes on an older commit but fails on HEAD and you need to pinpoint exactly which commit introduced the regression. Do not use for diagnosing a bug you already know the source of — use `flutter-debug` instead.

## Prerequisites

- The working tree is in a git repository (`git status` returns without error).
- The user provides (or you can infer) a **known-good** commit reference: a tag (`v1.2.0`), a branch name (`main@{7 days ago}`), or a full SHA.
- A **test oracle** is specified: a unit/widget test name pattern, a patrol test file, or a Bash-style exit-code command.
- No uncommitted changes that would interfere — stash them first (see Edge cases).

## Workflow

### 1. Confirm inputs before starting

Ask (or confirm from context) the following before calling any git command:

- **Good commit**: the last-known-good reference (tag, SHA, or relative ref).
- **Bad commit**: defaults to `HEAD`.
- **Oracle type**: `unit`, `widget`, or `patrol`.
- **Oracle selector**: test name pattern or patrol `testFilePath`.
- **Project**: call `mcp__plugin_flutter_flutter-ultra-build__list_projects` if not already known.
- **Has build_runner**: check for `build.yaml` in the project root — if present, set `needs_build_runner=true`.

### 2. Stash uncommitted changes

Before touching any git ref, check for dirty working tree:

```bash
git -C <project-root> status --porcelain
```

If output is non-empty, stash:

```bash
git -C <project-root> stash push -m "flutter-bisect-autoStash"
```

Record whether a stash was created — you must restore it in step 7.

### 3. Start bisect

```bash
git -C <project-root> bisect start --first-parent HEAD <good-commit>
```

`--first-parent` skips noise from merged feature branches and keeps the walk on the mainline. Git prints the number of steps remaining — surface this to the user.

### 4. At each bisect step — the Flutter-aware oracle loop

Repeat until git prints `<sha> is the first bad commit`:

#### 4a. Get current commit info

```bash
git -C <project-root> log -1 --format="%H %s"
```

Show the user which commit is under test and how many steps remain.

#### 4b. Restore Flutter state for this commit

Run these in order — do not skip even if pubspec.yaml looks unchanged (lockfile may differ):

1. **pub get**: `mcp__plugin_flutter_flutter-ultra-build__pub_get` with the project name.
   - If pub get fails (e.g. dependency conflict introduced by this commit), mark the commit **bad** and continue — a broken dep is a broken state.
2. **build_runner** (only if `needs_build_runner=true`):
   - Call `mcp__plugin_flutter_flutter-ultra-build__start_build_runner_build`.
   - Poll `mcp__plugin_flutter_flutter-ultra-build__poll_build_runner_job` until done.
   - Get result via `mcp__plugin_flutter_flutter-ultra-build__get_build_runner_result`.
   - If build_runner fails: mark the commit **bad** and continue.

#### 4c. Run the oracle

**Unit/widget oracle:**

- Start: `mcp__plugin_flutter_flutter-ultra-build__start_run_unit_tests` with `testNamePattern` (or `start_run_widget_tests`).
- Poll: `mcp__plugin_flutter_flutter-ultra-build__poll_run_unit_tests` (or `poll_run_widget_tests`).
- Result: `mcp__plugin_flutter_flutter-ultra-build__get_run_unit_tests_result` (or `get_run_widget_tests_result`).
- If all targeted tests pass → **good**. If any fail → **bad**.

**Patrol oracle:**

- Start: `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_test` with `testFilePath` and `device`.
- Poll: `mcp__plugin_flutter_flutter-ultra-patrol__poll_patrol_job`.
- Result: `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_result`.
- If all steps pass → **good**. If any fail → **bad**.

#### 4d. Mark the commit

```bash
# if oracle passed:
git -C <project-root> bisect good

# if oracle failed:
git -C <project-root> bisect bad
```

Git will output the next commit to test, or the final verdict. Loop back to 4a.

### 5. Capture and report the first bad commit

When git prints `<sha> is the first bad commit`, capture the full details:

```bash
git -C <project-root> show --stat <sha>
git -C <project-root> log -1 --format="%H%n%an <%ae>%n%ad%n%s%n%b" --date=iso <sha>
```

Present a structured report (see Output format).

### 6. Reset bisect

Always reset, even on error:

```bash
git -C <project-root> bisect reset
```

### 7. Restore stash (if created in step 2)

```bash
git -C <project-root> stash pop
```

## Edge cases

| Situation                                    | Handling                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Merge commits on the walk**                | `--first-parent` avoids them; if user omits it intentionally (to bisect a merged branch), remove the flag and warn that step count increases.                                                                                         |
| **Uncommitted changes**                      | Auto-stash in step 2; restore in step 7. If stash pop fails (conflict), warn the user and leave the stash intact — do not discard it.                                                                                                 |
| **Submodule repo**                           | `git bisect` operates on the outer repo. If the Flutter project is a submodule, confirm the user wants to bisect the outer aggregate, not the inner submodule. Pass the correct `-C <path>` to all git commands.                      |
| **Flutter SDK version change**               | If a commit changes the Flutter SDK constraint (`.tool-versions`, `fvm` config, `flutter.constraints`), call `mcp__plugin_flutter_flutter-ultra-build__flutter_clean` before pub get to clear the compiled kernel cache.              |
| **pub get resolves a different lockfile**    | Expected — this is exactly what the skill needs. Never pin the lockfile artificially during bisect.                                                                                                                                   |
| **Oracle is flaky**                          | If the oracle fails on a commit that visually looks clean, re-run it once. If it fails again, mark bad. Do not retry more than once per commit — flakiness analysis is out of scope here; use `flutter-debug` after bisect completes. |
| **All commits bad (misconfigured good ref)** | If `git bisect start` immediately shows 0 steps or git says the good commit is not an ancestor, stop and ask the user to verify the good commit reference.                                                                            |

## Output format

After bisect completes, produce:

```
## Bisect Result

First bad commit: <sha>
Author:  <name> <<email>>
Date:    <iso date>
Message: <subject line>

<body if present>

Files changed:
<git show --stat output>

Steps taken: <N> commits tested across <M> total candidates.
```

If bisect could not converge (user cancelled, all commits bad, or git error), produce:

```
## Bisect Aborted

Reason: <what went wrong>
Last tested commit: <sha or "none">
Recommendation: <next debugging step>
```

## Example

```
User: "The InvoiceBloc unit test was green on v1.3.0 but fails on HEAD. Find which commit broke it."

1. list_projects → project: "invora-flutter"
2. Check build.yaml → present → needs_build_runner=true
3. git status → clean → no stash needed
4. git bisect start --first-parent HEAD v1.3.0 → "~6 steps (roughly 53 revisions)"
5. [commit abc123] pub_get → ok; build_runner → ok; run_unit_tests(pattern: "InvoiceBloc") → FAIL → bisect bad
6. [commit def456] pub_get → ok; build_runner → ok; run_unit_tests → FAIL → bisect bad
7. [commit ghi789] pub_get → ok; build_runner → ok; run_unit_tests → PASS → bisect good
8. [commit jkl012] pub_get → ok; build_runner → ok; run_unit_tests → FAIL → bisect bad
9. [commit mno345] pub_get → ok; build_runner → ok; run_unit_tests → PASS → bisect good
10. [commit pqr678] pub_get → ok; build_runner → ok; run_unit_tests → FAIL → bisect bad
11. git: "pqr678 is the first bad commit"
12. git show --stat pqr678 → "refactor(billing): collapse invoice state machine"
13. git bisect reset
→ Report: first bad commit pqr678, author, date, changed files
```

## See also

- `flutter-test` — run the full test suite without bisecting
- `flutter-debug` — inspect live runtime state after bisect identifies a suspect commit
- `mcp__plugin_flutter_flutter-ultra-build__start_build_runner_build` — build_runner reference
- `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_test` — patrol oracle reference
