---
name: tour
description: Running route-by-route screenshot tours of a Flutter app. Use when capturing visual state across many app routes, doing pre-release visual regression sweeps, or documenting a feature's UI for review.
---

# Route Tour (stub)

**Status:** scaffold stub. Implementation owner: wave-3 skills worker (see plan §8.1, §12).

## Quick start

1. Identify the active session via `mcp__flutter-ultra-runtime__discover_sessions`.
2. For each route in the input list:
   - Navigate (web: browser navigate, mobile/desktop: GoRouter evaluate)
   - Wait for the root widget key
   - Take a screenshot, save to `.omc/research/tour-<date>/<route-slug>.png`
3. Write `tour-report.md` summarizing route to screenshot mapping.

## See also

- Plan §8.1
- Sibling skill: `drive` for multi-step interaction flows
