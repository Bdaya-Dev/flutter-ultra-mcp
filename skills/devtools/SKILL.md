---
name: devtools
description: Wiring up the Flutter DevTools panel for this plugin so the user can see live MCP activity inside their IDE. Use when the user wants to inspect the plugin's recent tool calls, attached sessions, or activity timeline.
disable-model-invocation: true
---

# DevTools (stub)

**Status:** scaffold stub. Implementation owner: wave-3 skills worker (see plan §8.6, §12).

User-triggered only — installing a dev dependency and editing pubspec is opinionated.

## Workflow

- Detect `ultra_flutter_devtools` in `dev_dependencies`; add via `mcp__flutter-ultra-build__pub_add` if missing.
- Start the panel WebSocket via `mcp__flutter-ultra-devtools__start_panel_server`.
- Print the DevTools URL with the `flutter-ultra` tab anchor.

## See also

- Plan §8.6, §6.2
