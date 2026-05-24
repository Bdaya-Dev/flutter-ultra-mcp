---
name: flutter-test
description: Orchestrates Flutter unit, widget, golden, and patrol E2E tests with focused reporting. Use when the user asks to run tests, validate a fix, check coverage, update golden screenshots, discover available tests, or triage a failing CI test suite locally.
---

# Test Orchestration

Covers all Flutter test layers: unit, widget, golden, and patrol E2E. For ad-hoc interactive flow verification without a written test, use `flutter-drive` instead.

## Workflow

### 1. Identify project and scope

- `mcp__plugin_flutter_flutter-ultra-build__list_projects` to find available projects. If the target project does not yet exist, use `mcp__plugin_flutter_flutter-ultra-build__create_project` to scaffold it before proceeding.
- `mcp__plugin_flutter_flutter-ultra-build__project_info` for the target project path, flavors, and entry points.
- `mcp__plugin_flutter_flutter-ultra-build__test_filter` to discover test files matching a name pattern before running.
- Determine scope from the user's request: unit only, widget only, patrol E2E only, golden only, full suite, or coverage.

### 2. Static analysis (fail fast)

`mcp__plugin_flutter_flutter-ultra-build__analyze` on the project. If errors are returned, report them and stop.

### 3. Unit and widget tests

**Start:**

- `mcp__plugin_flutter_flutter-ultra-build__start_run_unit_tests` with optional `testNamePattern` to scope.
- `mcp__plugin_flutter_flutter-ultra-build__start_run_widget_tests` similarly.
- Pass `coverage: true` when coverage is requested.

**Poll:**

- `mcp__plugin_flutter_flutter-ultra-build__poll_run_unit_tests` (or `poll_run_widget_tests`) until status is `completed` or `failed`.

**Results:**

- `mcp__plugin_flutter_flutter-ultra-build__get_run_unit_tests_result` (or `get_run_widget_tests_result`).
- Parse: total, passed, failed, skipped, duration, and per-failure details.

**Cancel:** `mcp__plugin_flutter_flutter-ultra-build__cancel_run_unit_tests` (or `cancel_run_widget_tests`) if interrupted.

### 4. Golden tests

**Validate existing goldens:**

- `mcp__plugin_flutter_flutter-ultra-build__start_run_golden_tests` -> `mcp__plugin_flutter_flutter-ultra-build__poll_run_golden_tests` -> `mcp__plugin_flutter_flutter-ultra-build__get_run_golden_tests_result`.
- Failures indicate visual regressions — the `.png` diff files show what changed.

**Update goldens after intentional UI changes:**

- `mcp__plugin_flutter_flutter-ultra-build__start_update_goldens` -> `mcp__plugin_flutter_flutter-ultra-build__poll_update_goldens` -> `mcp__plugin_flutter_flutter-ultra-build__get_update_goldens_result`.
- After updating, the changed `.png` files in `test/goldens/` must be committed.

**Cancel:** `mcp__plugin_flutter_flutter-ultra-build__cancel_run_golden_tests` or `mcp__plugin_flutter_flutter-ultra-build__cancel_update_goldens`.

### 5. Patrol E2E tests

**Discover tests:**

- `mcp__plugin_flutter_flutter-ultra-patrol__list_tests` to enumerate integration test files and individual test names.

**Start a patrol run:**

- `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_test` with `testFilePath`, `device`, and optional `flavor`.
- For develop/hot-reload mode: `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_develop` to start the test runner in watch mode.
  - `mcp__plugin_flutter_flutter-ultra-patrol__patrol_develop_run` to re-run a test.
  - `mcp__plugin_flutter_flutter-ultra-patrol__patrol_hot_reload` to reload after code changes.

**Poll:** `mcp__plugin_flutter_flutter-ultra-patrol__poll_patrol_job` until done.

**Screenshots during run:** `mcp__plugin_flutter_flutter-ultra-patrol__take_patrol_screenshot` at key intervals.

**Video recording:**

- `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_recording` before the test.
- `mcp__plugin_flutter_flutter-ultra-patrol__stop_patrol_recording` after.
- `mcp__plugin_flutter_flutter-ultra-patrol__extract_video_frame` to pull a specific frame for analysis.

**Results:**

- `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_result` — includes pass/fail per step, log context, screenshot paths.
- `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_browser_errors` for web E2E browser console errors.

**Web debugging:** `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_web_debugger_port` to get the Chrome DevTools port, then `mcp__plugin_flutter_flutter-ultra-browser__connect_over_cdp` for deeper inspection.

**Cancel:** `mcp__plugin_flutter_flutter-ultra-patrol__cancel_patrol_job`.

### 6. Integration tests (non-patrol)

- `mcp__plugin_flutter_flutter-ultra-build__start_run_integration_tests` to start the run.
- Poll and get results using the same pattern as unit/widget tests.
- Cancel with the corresponding cancel tool if interrupted.

### 7. Coverage report

After unit tests with `coverage: true`:

- `mcp__plugin_flutter_flutter-ultra-build__get_run_unit_tests_result` includes the coverage file path (`coverage/lcov.info`).
- Report the top-level line coverage percentage.
- For HTML report: `genhtml coverage/lcov.info -o coverage/html`.

## Failure triage

1. **Compilation errors**: surface the exact error from the result. Usually a missing import or type mismatch.
2. **Assertion failures**: show test name, expected/actual values, file:line.
3. **Timeout failures**: check for `pumpAndSettle` waiting on an infinite animation.
4. **Patrol E2E failures**: read `logContext` from `get_patrol_result`. Cross-reference with `get_patrol_browser_errors` for web.
5. **Screenshot on failure**: patrol captures screenshots automatically. For unit/widget failures, call `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` if the app is running.
6. **Network issues during E2E**: use `mcp__plugin_flutter_flutter-ultra-runtime__start_http_capture` + `mcp__plugin_flutter_flutter-ultra-runtime__get_http_events` to check API calls.
7. **Flaky tests due to external API responses**: use `mcp__plugin_flutter_flutter-ultra-browser__mock_network_route` before running patrol web tests to stub non-deterministic endpoints and isolate the test from network variance.

## Output format

```
## Test Results

| Layer | Total | Passed | Failed | Skipped | Duration |
|-------|-------|--------|--------|---------|----------|
| Unit  | 42    | 41     | 1      | 0       | 3.2s     |
| Widget| 18    | 18     | 0      | 0       | 8.1s     |
| E2E   | 5     | 4      | 1      | 0       | 47s      |

### Failures
**Unit: invoice_bloc_test.dart:87**
Expected: InvoiceListLoaded with 3 items
Got: InvoiceListLoaded with 0 items
```

## Tool reference

| Action             | Tool                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| List projects      | `mcp__plugin_flutter_flutter-ultra-build__list_projects`                    |
| Project info       | `mcp__plugin_flutter_flutter-ultra-build__project_info`                     |
| Discover tests     | `mcp__plugin_flutter_flutter-ultra-build__test_filter`                      |
| Static analysis    | `mcp__plugin_flutter_flutter-ultra-build__analyze`                          |
| Start unit tests   | `mcp__plugin_flutter_flutter-ultra-build__start_run_unit_tests`             |
| Poll unit tests    | `mcp__plugin_flutter_flutter-ultra-build__poll_run_unit_tests`              |
| Get unit results   | `mcp__plugin_flutter_flutter-ultra-build__get_run_unit_tests_result`        |
| Start widget tests | `mcp__plugin_flutter_flutter-ultra-build__start_run_widget_tests`           |
| Start golden tests | `mcp__plugin_flutter_flutter-ultra-build__start_run_golden_tests`           |
| Update goldens     | `mcp__plugin_flutter_flutter-ultra-build__start_update_goldens`             |
| Start integ tests  | `mcp__plugin_flutter_flutter-ultra-build__start_run_integration_tests`      |
| Poll integ tests   | `mcp__plugin_flutter_flutter-ultra-build__poll_run_integration_tests`       |
| Get integ results  | `mcp__plugin_flutter_flutter-ultra-build__get_run_integration_tests_result` |
| Cancel integ tests | `mcp__plugin_flutter_flutter-ultra-build__cancel_run_integration_tests`     |
| List patrol tests  | `mcp__plugin_flutter_flutter-ultra-patrol__list_tests`                      |
| Start patrol test  | `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_test`               |
| Poll patrol        | `mcp__plugin_flutter_flutter-ultra-patrol__poll_patrol_job`                 |
| Get patrol result  | `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_result`               |
| Patrol screenshot  | `mcp__plugin_flutter_flutter-ultra-patrol__take_patrol_screenshot`          |
| Patrol recording   | `mcp__plugin_flutter_flutter-ultra-patrol__start_patrol_recording`          |
| Extract frame      | `mcp__plugin_flutter_flutter-ultra-patrol__extract_video_frame`             |
| Browser errors     | `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_browser_errors`       |
| Web debugger port  | `mcp__plugin_flutter_flutter-ultra-patrol__get_patrol_web_debugger_port`    |
| Connect CDP        | `mcp__plugin_flutter_flutter-ultra-browser__connect_over_cdp`               |
| HTTP capture       | `mcp__plugin_flutter_flutter-ultra-runtime__start_http_capture`             |
| VM screenshot      | `mcp__plugin_flutter_flutter-ultra-runtime__screenshot`                     |

## Example

```
User: "Run the full test suite and show me what's failing."

1. list_projects -> project: "my-app"
2. analyze -> 0 errors, 3 warnings
3. start_run_unit_tests -> jobId: "unit-001"
4. poll_run_unit_tests -> completed
5. get_run_unit_tests_result -> 42 total, 1 failed
6. start_run_widget_tests -> 18/18 passed
7. list_tests -> 5 patrol tests
8. start_patrol_test(device: "web") -> jobId: "patrol-001"
9. poll_patrol_job -> completed, 1 failed
10. get_patrol_result -> logContext: "ZitadelException: invalid_client"
11. get_patrol_browser_errors -> CORS error on /oauth/v2/token
-> Report table + failure details
```

## See also

- `flutter-drive` — ad-hoc interactive flow automation without a written test
- `flutter-debug` — live runtime triage after a test exposes a bug
- `flutter-bisect` — git bisect to find which commit broke a passing test
