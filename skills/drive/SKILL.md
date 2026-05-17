---
name: drive
description: Driving multi-step user flows in a running Flutter app via gestures and assertions. Use when reproducing a bug across several screens, validating an onboarding flow, or running an ad-hoc end-to-end scenario without writing a patrol test.
---

# Drive (stub)

**Status:** scaffold stub. Implementation owner: wave-3 skills worker (see plan §8.2, §12).

## Workflow

- Enumerate interactive elements via `mcp__flutter-ultra-gesture__interactive_elements`.
- Tap or enter text using key-based finders.
- Verify intermediate state via `mcp__flutter-ultra-runtime__get_widget_tree`.
- For OAuth/popups: delegate to `mcp__flutter-ultra-browser__*` (web) or `mcp__flutter-ultra-native-mobile__*` (mobile).

## See also

- Plan §8.2
- Sibling skill: `test` for orchestrated patrol runs
