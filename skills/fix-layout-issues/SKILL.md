---
name: fix-layout-issues
description: Fixes Flutter layout errors (overflows, unbounded constraints) using Dart and Flutter MCP tools. Use when addressing "RenderFlex overflowed", "Vertical viewport was given unbounded height", or similar layout issues.
---

# Resolving Flutter Layout Errors

## Contents

- [Constraint Violation Diagnostics](#constraint-violation-diagnostics)
- [Layout Error Resolution Workflow](#layout-error-resolution-workflow)
- [Examples](#examples)

## Constraint Violation Diagnostics

Flutter layout operates on: **Constraints go down. Sizes go up. Parent sets position.** Layout errors occur when this negotiation fails.

- **"Vertical viewport was given unbounded height"**: Scrollable widget (`ListView`, `GridView`) inside unconstrained vertical parent (`Column`).
- **"An InputDecorator...cannot have an unbounded width"**: `TextField` inside unconstrained horizontal parent (`Row`).
- **"RenderFlex overflowed"**: Child of `Row` or `Column` requests more size than available. Yellow and black warning stripes.
- **"Incorrect use of ParentData widget"**: `ParentDataWidget` not a direct descendant of required ancestor (e.g., `Expanded` outside a `Flex`).
- **"RenderBox was not laid out"**: Cascading side-effect. Look further up the stack trace for the primary violation.

## Layout Error Resolution Workflow

### Task Progress

- [ ] Run the application in debug mode to capture the exception.
- [ ] Identify the primary error message (ignore cascading errors).
- [ ] Apply the conditional fix:
  - **"Unbounded height"**: Wrap scrollable child in `Expanded` or `SizedBox`.
  - **"Unbounded width"**: Wrap `TextField` in `Expanded` or `Flexible`.
  - **"RenderFlex overflowed"**: Wrap overflowing child in `Expanded` or `Flexible`.
  - **"Incorrect ParentData"**: Move the widget to be a direct child of its required parent.
- [ ] Execute Flutter hot reload.
- [ ] Verify the error screen or overflow stripes are resolved. Repeat if new errors appear.

## Examples

### Fixing Unbounded Height (ListView in Column)

**Before (Error):**

```dart
Column(
  children: <Widget>[
    const Text('Header'),
    ListView(
      children: const <Widget>[
        ListTile(title: Text('Item 1')),
        ListTile(title: Text('Item 2')),
      ],
    ),
  ],
)
```

**After (Fixed):**

```dart
Column(
  children: <Widget>[
    const Text('Header'),
    Expanded(
      child: ListView(
        children: const <Widget>[
          ListTile(title: Text('Item 1')),
          ListTile(title: Text('Item 2')),
        ],
      ),
    ),
  ],
)
```

### Fixing Unbounded Width (TextField in Row)

**Before:** `Row(children: [Icon(Icons.search), TextField()])`

**After:** `Row(children: [Icon(Icons.search), Expanded(child: TextField())])`

### Fixing RenderFlex Overflow

**Before:** `Row(children: [Icon(Icons.info), Text('Very long text...')])`

**After:** `Row(children: [Icon(Icons.info), Expanded(child: Text('Very long text...'))])`

## Flutter Ultra Integration

Diagnose and verify layout fixes with live app inspection:

- `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` — Fetch current runtime errors including RenderFlex overflows
- `mcp__plugin_flutter_flutter-ultra-runtime__dump_render_tree` — Inspect render tree to see constraint propagation
- `mcp__plugin_flutter_flutter-ultra-runtime__toggle_debug_paint` — Toggle debug paint to visualize layout boundaries
- `mcp__plugin_flutter_flutter-ultra-runtime__hot_reload` — Hot reload after applying fix to verify immediately
- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — Capture before/after screenshots of the fix

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
