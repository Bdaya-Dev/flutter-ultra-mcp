# ultra_flutter_devtools

Flutter DevTools extension UI for the `flutter-ultra-mcp` plugin. Shows live MCP activity: attached sessions, recent tool calls, errors, screenshot grid.

**Status:** scaffold stub. Implementation owner: **wave-2 devtools worker** (see plan §12, §6.2).

Loaded by Flutter DevTools as an iframe extension. Pairs with the [`flutter-ultra-devtools`](../../packages/flutter-ultra-devtools/) MCP server which tails `state/tool-events.jsonl` and pushes events over WebSocket.
