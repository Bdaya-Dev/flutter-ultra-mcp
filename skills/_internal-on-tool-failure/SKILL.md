---
name: _internal-on-tool-failure
description: Internal skill invoked by the PostToolUse hook when a flutter-ultra tool returns isError. Captures structured remediation context. Not for direct user invocation.
disable-model-invocation: true
---

# Internal: On Tool Failure (stub)

**Status:** scaffold stub. Implementation owner: wave-3 skills worker (see plan §12).

Triggered by the `PostToolUse` hook when an `mcp__flutter-ultra-*__*` tool returns `isError: true`. Reads the failure event from `state/tool-events.jsonl`, formats a one-line remediation summary, and appends it to the conversation as a system reminder.

Not advertised in the user-facing skill list.
