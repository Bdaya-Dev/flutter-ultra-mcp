# @flutter-ultra/flutter-ultra-devtools

MCP server backing the **DevTools panel**: live MCP activity, attached sessions, recent tool calls, errors, screenshot grid. Tails `state/tool-events.jsonl` and pushes via WebSocket to the panel iframe.

**Status:** scaffold stub. Implementation owner: **wave-2 devtools worker** (see plan §12).

Pairs with the `ultra_flutter_devtools` Dart package (the DevTools extension UI) — see `packages/ultra_flutter_devtools/`.
