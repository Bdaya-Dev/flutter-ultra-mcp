---
name: build-responsive-layout
description: Use `LayoutBuilder`, `MediaQuery`, or `Expanded/Flexible` to create a layout that adapts to different screen sizes. Use when you need the UI to look good on both mobile and tablet/desktop form factors.
---

# Implementing Adaptive Layouts

## Contents

- [Space Measurement Guidelines](#space-measurement-guidelines)
- [Widget Sizing and Constraints](#widget-sizing-and-constraints)
- [Device and Orientation Behaviors](#device-and-orientation-behaviors)
- [Workflow: Constructing an Adaptive Layout](#workflow-constructing-an-adaptive-layout)
- [Workflow: Optimizing for Large Screens](#workflow-optimizing-for-large-screens)
- [Examples](#examples)

## Space Measurement Guidelines

- **Use `MediaQuery.sizeOf(context)`** to get the size of the entire app window.
- **Use `LayoutBuilder`** to make layout decisions based on the parent widget's allocated space.
- **Do not use `MediaQuery.orientationOf` or `OrientationBuilder`** near the top of the widget tree. Device orientation does not accurately reflect available space.
- **Do not check for hardware types** ("phone" vs. "tablet"). Base all decisions strictly on available window space.

## Widget Sizing and Constraints

- **`Expanded`**: Force a child to fill all remaining available space.
- **`Flexible`**: Allow a child to size itself up to a limit while expanding/contracting. Use `flex` factor for sibling ratios.
- **Constrain Width**: Wrap widgets in `ConstrainedBox` with `maxWidth` on large screens.
- **Lazy Rendering**: Use `ListView.builder` or `GridView.builder` for long/unknown-length lists.

## Device and Orientation Behaviors

- **Do not lock screen orientation.** Causes severe layout issues on foldable devices.
- **Support Multiple Inputs:** Implement support for mice, trackpads, and keyboard shortcuts.

## Workflow: Constructing an Adaptive Layout

**Task Progress:**

- [ ] Identify the target widget.
- [ ] Wrap in a `LayoutBuilder`.
- [ ] Extract `constraints.maxWidth`.
- [ ] Define breakpoint (e.g., `600`).
- [ ] If `maxWidth > breakpoint`: Return large-screen layout (e.g., `Row` with sidebar).
- [ ] If `maxWidth <= breakpoint`: Return small-screen layout.
- [ ] Resize the app window -> review transitions -> fix overflow errors.

## Workflow: Optimizing for Large Screens

**Task Progress:**

- [ ] Identify full-width components.
- [ ] **Lists**: Convert `ListView.builder` to `GridView.builder` with `SliverGridDelegateWithMaxCrossAxisExtent`.
- [ ] **Forms/text**: Wrap in `ConstrainedBox` with `BoxConstraints(maxWidth: ...)`.
- [ ] Wrap in `Center` to keep constrained content centered.
- [ ] Test on desktop/tablet -> review horizontal stretching.

## Examples

### Adaptive Layout using LayoutBuilder

```dart
import 'package:flutter/material.dart';

const double largeScreenMinWidth = 600.0;

class AdaptiveLayout extends StatelessWidget {
  const AdaptiveLayout({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth > largeScreenMinWidth) {
          return Row(
            children: [
              const SizedBox(width: 250, child: Placeholder(color: Colors.blue)),
              const VerticalDivider(width: 1),
              Expanded(child: const Placeholder(color: Colors.green)),
            ],
          );
        } else {
          return const Placeholder(color: Colors.green);
        }
      },
    );
  }
}
```

### Constraining Width on Large Screens

```dart
class ConstrainedContent extends StatelessWidget {
  const ConstrainedContent({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 800.0),
          child: ListView.builder(
            itemCount: 50,
            itemBuilder: (context, index) => ListTile(title: Text('Item $index')),
          ),
        ),
      ),
    );
  }
}
```

## Flutter Ultra Integration

After building the layout, verify responsiveness across breakpoints:

- `mcp__plugin_flutter_flutter-ultra-runtime__audit_responsive` — Automated responsive audit at multiple viewport sizes
- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — Capture screenshots at each breakpoint
- `mcp__plugin_flutter_flutter-ultra-runtime__dump_render_tree` — Inspect render tree for constraint issues
- `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` — Check for overflow errors at different sizes

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
