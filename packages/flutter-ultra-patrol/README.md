# @flutter-ultra/flutter-ultra-patrol

MCP server orchestrating **Patrol E2E tests** across web, Android, iOS, and desktop. Wraps `patrol_cli` and bundles the [Bdaya patrol fork](https://github.com/Bdaya-Dev/patrol) as a submodule at `vendor/patrol/` so external contributors get the fork automatically with `git clone --recurse-submodules`.

## Tool catalogue (13 tools per plan §17B.1)

| Tool                           | Purpose                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `list_tests`                   | Walk `integration_test/` + `patrol_test/`, return `[{file, testNames[], tags[]}]`.                                                      |
| `start_patrol_test`            | MARATHON: spawn `patrol test ...`, return taskId immediately.                                                                           |
| `poll_patrol_job`              | Non-blocking status + rolling log tail for any marathon job.                                                                            |
| `get_patrol_result`            | Final structured `{passed, failed, skipped, durations, failures[]}` for a completed test job.                                           |
| `cancel_patrol_job`            | SIGTERM + SIGKILL grace period. Idempotent.                                                                                             |
| `start_patrol_develop`         | MARATHON: warm `patrol develop` session for repeat runs.                                                                                |
| `patrol_develop_run`           | Dispatch named test inside the warm session (much faster than a fresh `patrol test`).                                                   |
| `patrol_hot_reload`            | `r` / `R` to the develop session's stdin.                                                                                               |
| `take_patrol_screenshot`       | CDP screenshot via the develop session (Bdaya `f26306f6`).                                                                              |
| `start_patrol_recording`       | Bdaya CDP-based GIF/webm recorder.                                                                                                      |
| `stop_patrol_recording`        | Finalize the active recording.                                                                                                          |
| `get_patrol_browser_errors`    | CDP-captured browser console errors (Bdaya `b591a390`). Defaults to warm session, falls back to most recent test job, or pass `taskId`. |
| `get_patrol_web_debugger_port` | Surfaces the CDP port the Bdaya fork prints at web target startup so Playwright / DevTools can co-attach.                               |

## Environment contract (from plugin `.mcp.json`)

| Var                         | Used for                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLUTTER_ULTRA_PATROL_FORK` | Absolute path to `vendor/patrol/`.                                                                                                                                                                          |
| `FLUTTER_ULTRA_STATE_DIR`   | Future on-disk job persistence (in-memory in v1.0).                                                                                                                                                         |
| `PATROL_WEB_BROWSER_ARGS`   | Comma-separated Chromium flags merged into every `--web-browser-args`. Default: `--enable-unsafe-swiftshader,--disable-renderer-backgrounding,--disable-background-timer-throttling`. |
| `FLUTTER_ULTRA_LOG_LEVEL`   | `debug`/`info`/`warn`/`error`. Default `info`.                                                                                                                                                              |

## Invocation strategy

For each call we pick (in order):

1. `useRawCli: true` → skip wrapper detection.
2. `./scripts/run_patrol_web.ps1` (Windows) or `./scripts/run_patrol_web.sh` (Unix) at the project root → use it. Some projects standardize on this wrapper to pre-apply env vars + flags.
3. Otherwise spawn `dart run patrol_cli` from the project root, which resolves through `pubspec_overrides.yaml` to `vendor/patrol/packages/patrol_cli`.

Web invocations always set `--web-init-timeout 180000` by default (vs upstream's 60000 hardcode — see Bdaya fork PR #9 in `docs/UPSTREAM-PATROL-PRS.md`).
