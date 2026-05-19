---
name: flutter-design-audit
description: Audit the live Flutter app for design quality issues across accessibility, layout, and design-system conformance. Runs 10 checks (touch targets, semantics, text overflow, layout overflow, hardcoded colors, hardcoded text styles, inconsistent spacing, nested cards, over-centering, tiny text), extracts theme tokens, and tests at 4 responsive breakpoints. Produces a scored markdown report with per-issue fix suggestions.
---

# Flutter Design Audit

Collect live design evidence from the running app before writing any recommendations. All tools are read-only and safe to run without side effects.

## Workflow

### 1. Attach to the session

- `mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions` — find active sessions.
- `mcp__plugin_flutter_flutter-ultra-runtime__attach` with the matching sessionId.

### 2. Capture baseline screenshot

- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — visual snapshot before audit begins.

### 3. Run full design audit

Run the three audit tools in sequence. Each tool is independent and can be called separately.

#### 3a. Run all design checks

```
mcp__plugin_flutter_flutter-ultra-runtime__audit_design
  sessionId: <id>
  # checks defaults to all 10 — omit for full audit
```

Checks performed:

| Check                  | Severity | What it detects                               |
| ---------------------- | -------- | --------------------------------------------- |
| `touch_targets`        | error    | Tappable widgets < 48×48 dp (WCAG 2.5.5)      |
| `missing_semantics`    | warning  | Interactive widgets without a Semantics label |
| `text_overflow`        | warning  | Text widgets clipping or showing ellipsis     |
| `layout_overflow`      | error    | RenderFlex / RenderBox overflow               |
| `hardcoded_color`      | info     | Colors not from colorScheme                   |
| `hardcoded_text_style` | info     | TextStyle with raw fontSize/color             |
| `inconsistent_spacing` | info     | Padding values not on a 4 dp grid             |
| `nested_cards`         | warning  | Card inside Card (doubled elevation)          |
| `everything_centered`  | info     | >80% of Text nodes use TextAlign.center       |
| `tiny_text`            | warning  | Text with fontSize < 12 dp                    |

Scores returned: `accessibility` (0–100), `layout` (0–100), `designSystem` (0–100).

#### 3b. Extract design tokens

```
mcp__plugin_flutter_flutter-ultra-runtime__extract_design_tokens
  sessionId: <id>
```

Returns:

- `colorScheme` — all Material 3 color roles as hex strings.
- `textTheme` — fontSize for each text style (displayLarge → labelSmall).
- `brightness` — `light` or `dark`.
- `violations` — list of token reads that failed (evaluate unavailable).

#### 3c. Responsive audit at 4 breakpoints

```
mcp__plugin_flutter_flutter-ultra-runtime__audit_responsive
  sessionId: <id>
  # viewports defaults to compact/medium/expanded/large
```

Default viewports:

| Label    | Size     |
| -------- | -------- |
| compact  | 375×667  |
| medium   | 768×1024 |
| expanded | 1200×800 |
| large    | 1440×900 |

Returns per-viewport issue counts and `crossViewportIssues` identifying regressions across breakpoints.

Note: viewport resizing requires a web or desktop debug build. On mobile/release builds, results reflect the current native window size.

### 4. Capture per-viewport screenshots (optional)

If the responsive audit shows regressions, take a screenshot at each problematic viewport to document the issue:

```
mcp__plugin_flutter_flutter-ultra-runtime__screenshot
  sessionId: <id>
  width: 375
  height: 667
```

### 5. Deeper investigation for specific issues

#### Touch target failures

1. `mcp__plugin_flutter_flutter-ultra-runtime__find_widget` with `finder: { type: 'InkWell' }` to locate all tappable areas.
2. `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_details` on the failing widget to confirm its bounds.
3. `mcp__plugin_flutter_flutter-ultra-runtime__toggle_debug_paint` to visualise hit-test areas.

#### Layout overflow

1. `mcp__plugin_flutter_flutter-ultra-runtime__dump_render_tree` — search for `OVERFLOWED`.
2. `mcp__plugin_flutter_flutter-ultra-runtime__toggle_debug_paint` to show overflow markers.
3. `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — capture the debug paint view.

#### Semantics gaps

1. `mcp__plugin_flutter_flutter-ultra-runtime__dump_semantics_tree` — find nodes without labels.
2. On mobile: `mcp__plugin_flutter_flutter-ultra-native-mobile__dump_a11y_tree` for the OS-level accessibility tree.

#### Hardcoded colors / text styles

1. `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to inspect a specific widget's style:
   ```dart
   // Example: read the actual color of a Text widget's style
   (context.findRenderObject() as RenderParagraph).text.style?.color?.value.toRadixString(16)
   ```
2. Compare against `extract_design_tokens` output to identify deviations.

## Output format

Produce a markdown report with the following sections:

### Design Audit Report

**App:** `<sessionId>`
**Date:** `<today>`
**Scores:** Accessibility: X/100 | Layout: Y/100 | Design System: Z/100

#### Issues (N total — E errors, W warnings, I info)

| Severity | Rule          | Widget     | Issue                          | Suggestion               |
| -------- | ------------- | ---------- | ------------------------------ | ------------------------ |
| error    | touch_targets | IconButton | 32×32 dp — below 48 dp minimum | Wrap in SizedBox(48, 48) |
| ...      |               |            |                                |                          |

#### Design Tokens

**Color Scheme (brightness: light)**

| Role    | Hex     |
| ------- | ------- |
| primary | #006590 |
| ...     |         |

**Text Theme**

| Style        | Size  |
| ------------ | ----- |
| displayLarge | 57 dp |
| ...          |       |

#### Responsive Analysis

| Viewport | Size     | Issues |
| -------- | -------- | ------ |
| compact  | 375×667  | 3      |
| medium   | 768×1024 | 2      |
| ...      |          |        |

**Cross-viewport regressions:** `<crossViewportIssues list or "None">`

#### Screenshots

- Baseline: `<path>`
- compact viewport: `<path if captured>`

## Common fix patterns

| Issue                  | Fix                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Touch target too small | `SizedBox(width: 48, height: 48, child: icon)` or `IconButton(padding: EdgeInsets.all(12))` |
| Missing semantics      | `Semantics(label: 'Close dialog', child: icon)`                                             |
| Text overflow          | `Text(str, maxLines: 2, overflow: TextOverflow.ellipsis)` inside `Flexible`                 |
| Layout overflow        | Replace `Row` with `Wrap`, or add `Flexible`/`Expanded` to children                         |
| Hardcoded color        | Replace `Color(0xFF006590)` with `Theme.of(context).colorScheme.primary`                    |
| Hardcoded TextStyle    | Replace `TextStyle(fontSize: 16)` with `Theme.of(context).textTheme.bodyLarge`              |
| Nested Cards           | Replace inner `Card` with `Container` + `decoration: BoxDecoration(borderRadius: ...)`      |
| Over-centering         | Use `TextAlign.start` for body copy; reserve `center` for headings                          |
| Tiny text              | Increase to ≥ 12 dp, or use `textTheme.labelSmall` (14 dp minimum by M3 spec)               |
| Inconsistent spacing   | Use `const EdgeInsets.all(8)` / `16` / `24` — multiples of 4                                |

## See also

- `flutter-debug` — triage runtime exceptions and layout overflows in detail
- `flutter-tour` — navigate the app to audit each screen systematically
