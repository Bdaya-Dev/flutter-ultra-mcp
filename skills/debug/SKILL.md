---
name: debug
description: Attaching to a running Flutter app and triaging an error from the stack trace, widget tree, render tree, and recent screenshot. Use when the user reports a runtime exception, layout overflow, or unexpected behaviour and you need to inspect live state.
---

# Debug (stub)

**Status:** scaffold stub. Implementation owner: wave-3 skills worker (see plan §8.3, §12).

## Workflow

- `mcp__flutter-ultra-runtime__discover_sessions` and pick the target app.
- Pull recent errors with `mcp__flutter-ultra-runtime__get_runtime_errors`.
- Cross-reference frames with `mcp__flutter-ultra-runtime__get_widget_tree` and `dump_render_tree`.
- Capture a screenshot for context.
- Propose a fix inline; do not edit code unless asked.

## See also

- Plan §8.3
