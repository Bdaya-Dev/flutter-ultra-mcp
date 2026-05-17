# @flutter-ultra/flutter-ultra-build

MCP server for Flutter **build-time** tasks: pubspec, codegen, analyze, format, tests, builds, signing, l10n, assets, web validators.

Part of the [flutter-ultra-mcp](https://github.com/Bdaya-Dev/flutter-ultra-mcp) plugin (8 specialized MCP servers for Flutter automation). This package focuses on _build-time_ surface area — it never connects to a running app. For runtime control (hot reload, widget inspection) see `@flutter-ultra/flutter-ultra-runtime`.

## Tool groups (~50 tools)

| Group             | Representative tools                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project meta      | `list_projects`, `project_info`, `list_flavors`, `list_dart_defines`                                                                                                                                                                                   |
| Analysis & format | `analyze`, `format`, `fix`, `fix_preview`, `flutter_doctor`, `flutter_clean`, `pub_cache_repair`                                                                                                                                                       |
| Pubspec & deps    | `pub_get`, `pub_add`, `pub_remove`, `pub_upgrade`, `pub_outdated`, `pub_deps`, `pub_dev_search`, `pubspec_overrides_*`, `start_pub_upgrade_major` (+ poll / get / cancel)                                                                              |
| Codegen           | `start_build_runner_build` (+ poll / get / cancel), `start_build_runner_watch` (+ poll / stop), `flutter_gen_l10n`                                                                                                                                     |
| Tests             | `start_run_unit_tests`, `start_run_widget_tests`, `start_run_integration_tests`, `start_run_golden_tests`, `start_update_goldens` (each + poll / get / cancel), `test_filter`                                                                          |
| Builds            | `start_build_apk` / `start_build_appbundle` / `start_build_ipa` (Mac) / `start_build_web` / `start_build_windows` (Win) / `start_build_macos` (Mac) / `start_build_linux` (Linux), each with `poll_build_<plat>_job` / `get_*_result` / `cancel_*_job` |
| Mobile signing    | `verify_android_signing`, `verify_ios_signing` (Mac-only), `set_bundle_id` (atomic Android+iOS update)                                                                                                                                                 |
| l10n / ARB        | `list_missing_translations`, `arb_diff`, `arb_add_key`, `arb_remove_key`                                                                                                                                                                               |
| Assets            | `add_asset`, `validate_assets`, `list_orphan_assets`                                                                                                                                                                                                   |
| Web pre-flight    | `validate_web_redirect`, `validate_canvaskit_vs_html_consistency`, `flush_service_worker`                                                                                                                                                              |

All long-running tools (builds, codegen, tests, pub-upgrade-major) follow the **MARATHON split-tool pattern** documented in the plan §17.5: each exposes a `start_<x>` / `poll_<x>_job` / `get_<x>_result` / `cancel_<x>_job` quartet so no sync MCP call ever exceeds 55 s. Job state persists at `${CLAUDE_PLUGIN_DATA}/state/jobs/<jobId>.json` and survives MCP server restarts.

## Cross-cutting behavior

- **Watchdog**: every tool wrapped in `withWatchdog` with a per-tool ceiling. Host-side cancellation propagates to child processes via `SIGTERM` → 2 s grace → `SIGKILL`.
- **Logging**: stderr only, JSON-lines, respects `FLUTTER_ULTRA_LOG_LEVEL`. Stdout reserved for JSON-RPC framing.
- **Keep-alive**: 30 s `notifications/message` (debug) defeats the Bun-idle-SIGKILL bug ([claude-code #58004](https://github.com/anthropics/claude-code/issues/58004)).
- **Per-tool timeout overrides**: `FLUTTER_ULTRA_TOOL_TIMEOUT_<TOOL_NAME>=<ms>` env var raises the ceiling for power users.

## CLI dependencies

Tools shell out to:

- `dart` (required) — analysis, format, fix, pub, build_runner
- `flutter` (required for any Flutter-specific tool) — pub, gen-l10n, test, build
- `keytool` (optional, for `verify_android_signing`)
- `xcodebuild` (Mac-only, for `verify_ios_signing`)

Resolution order: env override (`FLUTTER_ULTRA_DART_BIN`, `FLUTTER_ULTRA_FLUTTER_BIN`) → PATH lookup. Missing CLIs raise `FlutterCliMissingError` with install hints.

## Running standalone

```jsonc
// .claude/mcp.json
{
  "mcpServers": {
    "flutter-ultra-build": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/servers/flutter-ultra-build/dist/index.js"],
    },
  },
}
```

## References

- Plan §5.1 — tool catalogue (build server)
- Plan §16 — naming, schema, output conventions (binding for all servers)
- Plan §17 — timeout resilience model + split-tool pattern (binding)
