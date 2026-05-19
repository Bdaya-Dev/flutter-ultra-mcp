---
name: flutter-design-verify
description: Compare a running Flutter app against Figma mockups. Captures screenshots at multiple viewports, extracts theme tokens and component inventory, then uses Claude vision to identify design-implementation drift between the live app and Figma frames.
---

# Flutter Design Verify

Compare a live Flutter app against Figma designs. Collect evidence from both sources, then produce a side-by-side report identifying drift.

## Prerequisites

- Flutter app is running in debug mode (web or desktop for viewport resizing).
- Figma MCP plugin is installed and authenticated (`mcp__plugin_figma_figma__authenticate`).
- User has the Figma file URL containing the design frames.

## Workflow

### 1. Attach to the running Flutter session

```
mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions
```

Pick the matching session, then:

```
mcp__plugin_flutter_flutter-ultra-runtime__attach
  sessionId: <id>
```

### 2. Capture Flutter screenshots

Capture the current screen, then navigate to each route and repeat:

```
mcp__plugin_flutter_flutter-ultra-runtime__screenshot
  sessionId: <id>
  width: 375
  height: 667
```

Capture at relevant viewports (compact 375×667, medium 768×1024, expanded 1200×800) using `audit_responsive` as a guide for which breakpoints show regressions.

### 3. Extract Flutter design tokens

```
mcp__plugin_flutter_flutter-ultra-runtime__extract_design_tokens
  sessionId: <id>
```

Returns `colorScheme`, `textTheme`, and `brightness`. These become the Flutter side of the token diff.

### 4. Extract component inventory

```
mcp__plugin_flutter_flutter-ultra-runtime__extract_component_inventory
  sessionId: <id>
```

Returns per-type widget counts grouped by category (input / container / display / layout / navigation). Use this to map Flutter components to Figma component usage.

### 5. Run design audit (optional but recommended)

```
mcp__plugin_flutter_flutter-ultra-runtime__audit_design
  sessionId: <id>
```

Pre-flight check — surface existing issues before comparing against Figma.

```
mcp__plugin_flutter_flutter-ultra-runtime__audit_responsive
  sessionId: <id>
```

Identify which viewports have the most drift so Figma frame selection can match.

### 6. Retrieve Figma designs

Ask the user for the Figma file URL if not already provided.

#### 6a. Get Figma frame screenshots

```
mcp__plugin_figma_figma__get_screenshot
  url: <figma-frame-url>
```

Capture one screenshot per screen / frame that corresponds to the Flutter routes captured in step 2. Match by route name or frame title.

#### 6b. Get Figma design tokens (variables)

```
mcp__plugin_figma_figma__get_variable_defs
  url: <figma-file-url>
```

Returns color, typography, spacing, and radius variables. These become the Figma side of the token diff.

### 7. Vision comparison

Present each Flutter screenshot alongside its matching Figma frame to Claude for visual analysis. For each pair, identify:

- **Color drift** — buttons, backgrounds, text colors that differ.
- **Typography drift** — font sizes, weights, line heights that differ.
- **Spacing drift** — padding, gap, margin inconsistencies.
- **Missing components** — UI elements present in Figma but absent in Flutter.
- **Extra components** — UI elements in Flutter not in Figma (scope creep).
- **Layout drift** — column/row arrangements, alignment, wrapping differences.

### 8. Token diff

Compare `extract_design_tokens` output against `get_variable_defs` output:

| Token               | Flutter value | Figma value | Match? |
| ------------------- | ------------- | ----------- | ------ |
| primary color       | #006590       | #006591     | NO     |
| bodyMedium fontSize | 14 dp         | 14 sp       | YES    |
| ...                 |               |             |        |

Flag every mismatch as a drift item with severity:

- **error** — value differs by more than 10% or is a completely different hue.
- **warning** — value differs by ≤ 10% (rounding or unit conversion).
- **info** — token present in Flutter but missing from Figma variables, or vice versa.

### 9. Component mapping

Cross-reference `extract_component_inventory` output against Figma component usage:

- List Flutter components with no Figma counterpart.
- List Figma components with no Flutter counterpart.
- Flag count mismatches (e.g., Flutter has 14 ElevatedButton instances, Figma frame shows 2).

## Output format

Produce a markdown report:

### Design Verification Report

**Flutter session:** `<sessionId>`
**Figma file:** `<url>`
**Date:** `<today>`

#### Visual Comparison

For each Flutter route ↔ Figma frame pair:

| Screen | Flutter screenshot | Figma frame | Drift items |
| ------ | ------------------ | ----------- | ----------- |
| /home  | (image)            | (image)     | 3 errors    |

#### Token Diff Table

| Token   | Flutter | Figma   | Status  |
| ------- | ------- | ------- | ------- |
| primary | #006590 | #006591 | warning |

#### Component Mapping

| Type           | Flutter count | In Figma? | Notes                   |
| -------------- | ------------- | --------- | ----------------------- |
| ElevatedButton | 14            | yes       | Figma shows 2 per frame |

#### Summary

- Total drift items: N (E errors, W warnings, I info)
- Token mismatches: N
- Missing Figma components in Flutter: N
- Recommendation: list top 3 highest-impact fixes

## See also

- `flutter-design-audit` — standalone Flutter design quality audit without Figma
- `flutter-figma-push` — push Flutter web screenshots to Figma as editable frames
- `flutter-tour` — navigate all routes for comprehensive per-screen capture
