---
name: _internal-session-bootstrap
description: Internal skill invoked by the SessionStart hook to detect Flutter context and warm cached state. Not for direct user invocation.
disable-model-invocation: true
---

# Internal: Session Bootstrap (stub)

**Status:** scaffold stub. Implementation owner: wave-3 skills worker (see plan §12).

Triggered by the `SessionStart` hook. Performs:
- Project root detection (`pubspec.yaml` walk)
- Cached session discovery refresh
- Plugin-doctor self-check
- Initial telemetry frame written to `state/tool-events.jsonl`

Not advertised in the user-facing skill list.
