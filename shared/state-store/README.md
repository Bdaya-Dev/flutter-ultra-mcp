# @flutter-ultra/state-store

Cross-server shared-state helper. Implements the file-based IPC strategy from plan §4 — atomic JSON-file read-modify-write under `${CLAUDE_PLUGIN_DATA}/state/` with `proper-lockfile` + `chokidar` watchers.

**Status:** scaffold stub. Implementation owner: shared infra (wave 2).

Files under `state/` (per plan §4 table):
- `sessions.json` — owned by `flutter-ultra-runtime`
- `browsers.json` — owned by `flutter-ultra-browser`
- `native-targets.json` — owned by native-mobile/-desktop
- `tool-events.jsonl` — append-only, consumed by `flutter-ultra-devtools`
