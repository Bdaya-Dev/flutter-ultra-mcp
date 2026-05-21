---
name: add-widget-preview
description: Adds interactive widget previews to the project using the previews.dart system. Use when creating new UI components or updating existing screens to ensure consistent design and interactive testing.
---

# Previewing Flutter Widgets

## Contents

- [Preview Guidelines](#preview-guidelines)
- [Handling Limitations](#handling-limitations)
- [Workflows](#workflows)
- [Examples](#examples)

## Preview Guidelines

Use the Flutter Widget Previewer to render widgets in real-time, isolated from the full application context.

- **Target Elements:** Apply the `@Preview` annotation to top-level functions, static methods, or public widget constructors/factories that have no required arguments and return a `Widget` or `WidgetBuilder`.
- **Imports:** Always import `package:flutter/widget_previews.dart`.
- **Custom Annotations:** Extend the `Preview` class to create custom annotations that inject common properties (themes, wrappers).
- **Multiple Configurations:** Apply multiple `@Preview` annotations to generate multiple preview instances. Or extend `MultiPreview`.
- **Runtime Transformations:** Override `transform()` in custom `Preview` or `MultiPreview` classes for dynamic modification.

## Handling Limitations

The Widget Previewer runs in a web environment:

- **No Native APIs:** Do not use `dart:io` or `dart:ffi`. Use conditional imports to mock or bypass.
- **Asset Paths:** Use package-based paths (e.g., `packages/my_package_name/assets/my_image.png`).
- **Public Callbacks:** Ensure all callback arguments are public and constant.
- **Constraints:** Apply explicit constraints using the `size` parameter if your widget is unconstrained.

## Workflows

### Creating a Widget Preview

- [ ] Import `package:flutter/widget_previews.dart`.
- [ ] Identify a valid target (top-level function, static method, or parameter-less constructor).
- [ ] Apply the `@Preview` annotation.
- [ ] Configure parameters (`name`, `group`, `size`, `theme`, `brightness`).
- [ ] If applying same config to multiple widgets, extract into a custom class extending `Preview`.

### Interacting with Previews

**If using a supported IDE (Flutter 3.38+):**

1. Launch the IDE. Widget Previewer starts automatically.
2. Open the "Flutter Widget Preview" tab.
3. Toggle "Filter previews by selected file" if needed.

**If using the Command Line:**

1. Navigate to the project root.
2. Run `flutter widget-preview start`.
3. View in the Chrome environment.

## Examples

### Basic Preview

```dart
import 'package:flutter/widget_previews.dart';
import 'package:flutter/material.dart';

@Preview(name: 'My Sample Text', group: 'Typography')
Widget mySampleText() {
  return const Text('Hello, World!');
}
```

### MultiPreview Implementation

```dart
import 'package:flutter/widget_previews.dart';
import 'package:flutter/material.dart';

final class MultiBrightnessPreview extends MultiPreview {
  const MultiBrightnessPreview({required this.name});
  final String name;

  @override
  List<Preview> get previews => const [
    Preview(brightness: Brightness.light),
    Preview(brightness: Brightness.dark),
  ];

  @override
  List<Preview> transform() {
    final previews = super.transform();
    return previews.map((preview) {
      final builder = preview.toBuilder()
        ..group = 'Brightness'
        ..name = '$name - ${preview.brightness!.name}';
      return builder.toPreview();
    }).toList();
  }
}

@MultiBrightnessPreview(name: 'Primary Card')
Widget cardPreview() => const Card(
  child: Padding(padding: EdgeInsets.all(8.0), child: Text('Content')),
);
```

## Flutter Ultra Integration

After adding `@Preview` annotations, use these tools to view and capture previews:

- `mcp__plugin_flutter_flutter-ultra-runtime__launch_app` — Launch the app to render previews
- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — Capture preview screenshots for documentation
- `mcp__plugin_flutter_flutter-ultra-build__analyze` — Verify preview annotations are syntactically correct

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
