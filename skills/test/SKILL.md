---
name: flutter-test
description: Orchestrating Flutter unit, widget, and patrol E2E tests with focused reporting. Use when the user asks to run tests, validate a fix, or check coverage on a Flutter project.
---

# flutter-test — Test Orchestration

## When to use

Use this skill when the user asks to run tests, validate that a fix works, check coverage, or triage a failing CI test suite locally. This skill covers all three Flutter test layers: unit, widget, and patrol E2E. For ad-hoc interactive flow verification without a written test, use `flutter-drive` instead.

## Prerequisites

- A Flutter project is available and identifiable (pubspec.yaml present).
- For patrol E2E: the app must be buildable for the target device/web. A connected device or emulator is required for mobile E2E.
- For coverage reports: `lcov` must be available on the host, or the skill produces the raw `lcov.info` path for the user.

## Workflow

### 1. Identify the project and test scope

- Call `mcp__plugin_flutter_flutter-ultra-build__list_projects` to find available projects.
- Call `mcp__plugin_flutter_flutter-ultra-build__project_info` for the target project to confirm the project path and available flavors.
- Determine the test scope from the user's request:
  - **Unit/widget only** → sections 2–3
  - **Patrol E2E only** → section 4
  - **Full suite** → sections 2–4 in order
  - **Coverage** → section 2 with coverage flag, then section 5

### 2. Static analysis first (fail fast)

Before running any tests, call `mcp__plugin_flutter_flutter-ultra-build__analyze` on the project.

- If analysis returns errors (not warnings): report them and stop — tests will fail to compile anyway.
- If analysis returns only warnings: continue but include the warning count in the final report.

### 3. Unit and widget tests

**Start the test run:**

- Unit tests: `mcp__plugin_flutter_flutter-ultra-build__start_run_unit_tests`
  - Pass `testNamePattern` to scope to a specific test file or test name regex (e.g. `invoice_bloc_test`, `.*BlocTest.*`).
  - Pass `coverage: true` when the user requests coverage.
- Widget tests: `mcp__plugin_flutter_flutter-ultra-build__start_run_widget_tests`
  - Same pattern filtering applies.

**Poll until complete:**

- Call `mcp__plugin_flutter_flutter-ultra-build__poll_run_unit_tests` (or `poll_run_widget_tests`) in a loop until status is `completed` or `failed`.
- Poll interval: respect the tool's natural response time; do not sleep artificially.

**Get results:**

- Call `mcp__plugin_flutter_flutter-ultra-build__get_run_unit_tests_result` (or `get_run_widget_tests_result`).
- Parse: total tests, passed, failed, skipped, duration.
- For each failure: extract test name, file path, line number, and failure message.

**Cancellation:** if the user interrupts, call `mcp__plugin_flutter_flutter-ultra-build__cancel_run_unit_tests` (or `cancel_run_widget_tests`).

### 4. Patrol E2E tests

**Discover available tests:**

- Call `mcp__plugin_flutter_flutter-ultra-patrol__list_tests` to enumerate test files and individual test names in `integration_test/`.

**Start a patrol run:**

- Call `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_test` with:
  - `testFilePath` or `testName` to scope the run.
  - `device` for the target (web, emulator ID, or physical device ID from `mcp__plugin_flutter_flutter-ultra-runtime__list_devices`).
  - `flavor` if the project uses flavors.

**Poll until complete:**

- Call `mcp__plugin_flutter_flutter-ultra-patrol__poll_patrol_job` in a loop until done.
- While polling, optionally call `mcp__plugin_flutter_flutter-ultra-patrol__take_patrol_screenshot` at key intervals to capture mid-test state.

**Get enriched results:**

- Call `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_result`.
- The result includes:
  - Pass/fail per test step
  - `logContext`: log lines captured around the failure point
  - Screenshot paths captured during the test
  - Browser console errors (for web): call `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_browser_errors` for additional detail.

**For web E2E failures**: also call `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_web_debugger_port` to get the Chrome DevTools port, then use `mcp__plugin_flutter_flutter-ultra-browser__connect_over_cdp` for deeper inspection.

**Cancellation:** call `mcp__plugin_flutter_flutter-ultra-patrol__cancel_patrol_job` if interrupted.

### 5. Coverage report (when requested)

After unit tests complete with `coverage: true`:

- The build server writes `coverage/lcov.info` relative to the project root.
- Call `mcp__plugin_flutter_flutter-ultra-build__get_run_unit_tests_result` — the result includes the coverage file path.
- Report the top-level line coverage percentage if parseable.
- If the user wants an HTML report: note that they can run `genhtml coverage/lcov.info -o coverage/html` locally.
- Do not attempt to parse `lcov.info` manually — report the file path and overall percentage only.

### 6. Golden test handling

When the user asks to update or validate golden screenshots:

- **Validate**: `mcp__plugin_flutter_flutter-ultra-build__start_run_golden_tests` → `poll_run_golden_tests` → `get_run_golden_tests_result`.
- **Update**: `mcp__plugin_flutter_flutter-ultra-build__start_update_goldens` → `poll_update_goldens` → `get_update_goldens_result`.
- After updating, note that the changed `.png` files in `test/goldens/` must be committed.

## Failure triage

When tests fail, apply this triage sequence:

1. **Compilation errors** (test file won't load): surface the exact error from the result — usually a missing import or type mismatch. Fix the test file if asked.
2. **Assertion failures** (expected ≠ actual): show the test name, expected value, actual value, and file:line. Do not auto-fix unless asked.
3. **Timeout failures**: check if the test awaits a Future that never resolves. Suggest checking if `pumpAndSettle` is waiting on an infinite animation.
4. **Patrol E2E failures**: read `logContext` from `get_patrol_result` — it contains the log lines immediately before the failure. Cross-reference with `get_patrol_browser_errors` for web.
5. **Screenshot on failure**: patrol captures screenshots automatically on failure; report the path. For unit/widget failures, call `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` if the app is running in debug mode.

## Output format

After all test layers complete, produce a structured summary:

```
## Test Results

| Layer | Total | Passed | Failed | Skipped | Duration |
|-------|-------|--------|--------|---------|----------|
| Unit  | 42    | 41     | 1      | 0       | 3.2s     |
| Widget| 18    | 18     | 0      | 0       | 8.1s     |
| E2E   | 5     | 4      | 1      | 0       | 47s      |

### Failures

**Unit: invoice_bloc_test.dart:87** — `InvoiceListBloc`
Expected: `InvoiceListLoaded` with 3 items
Got: `InvoiceListLoaded` with 0 items

**E2E: login_flow_test.dart — "should redirect to dashboard after login"**
Log context: [ERROR] ZitadelException: invalid_client at 14:23:01.332
Screenshot: .omc/research/patrol-2026-05-19/login_flow_failure.png
```

Include the coverage percentage at the bottom if coverage was requested.

## Example

```
User: "Run the full test suite for the Invora Flutter app and show me what's failing."

1. list_projects → project: clients/invora/invora-flutter
2. analyze → 0 errors, 3 warnings (continue)
3. start_run_unit_tests(project: "invora-flutter") → jobId: "unit-001"
4. poll_run_unit_tests(jobId: "unit-001") → completed
5. get_run_unit_tests_result → 42 total, 1 failed: invoice_bloc_test.dart:87
6. start_run_widget_tests(project: "invora-flutter") → jobId: "widget-001"
7. poll_run_widget_tests → completed, 18/18 passed
8. list_tests(project: "invora-flutter") → 5 patrol tests
9. start_patrol_test(testFilePath: "integration_test/", device: "web") → jobId: "patrol-001"
10. poll_patrol_job → completed, 1 failed: login_flow_test.dart
11. get_patrol_result → logContext: "ZitadelException: invalid_client", screenshot path
12. get_patrol_browser_errors → CORS error on /oauth/v2/token
→ Report table + failure details
```

## See also

- Sibling skill: `flutter-drive` for ad-hoc interactive flow automation without a written test
- Sibling skill: `flutter-debug` for live runtime triage after a test exposes a bug
- `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_result` — enriched E2E failure context
- `mcp__plugin_flutter_flutter-ultra-build__test_filter` — narrow test scope by name or file pattern
