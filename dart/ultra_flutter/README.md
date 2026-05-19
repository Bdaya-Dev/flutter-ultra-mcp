# ultra_flutter

In-app Flutter binding mixin for the [flutter-ultra-mcp](https://github.com/Bdaya-Dev/flutter-ultra-mcp) Claude Code plugin.

Exposes `ext.flutter.ultra.*` VM service extensions (gesture dispatch, screenshot, widget inspection, screencast, log collection) that the plugin's MCP servers consume. Composable with Sentry and other `WidgetsFlutterBinding` subclasses via the mixin form.

## Usage

```dart
import 'package:flutter/foundation.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

void main() {
  if (kDebugMode) {
    UltraFlutterBinding.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}
```

### With Sentry

```dart
class AppBinding extends WidgetsFlutterBinding
    with SentryWidgetsBindingMixin, UltraFlutterBinding {}

void main() {
  if (kDebugMode) {
    AppBinding.ensureInitialized();
  }
  // ...
}
```

## Registered extensions

| Extension | Purpose |
|-----------|---------|
| `ultra.tap` | Tap element by key, text, or type |
| `ultra.doubleTap` | Double-tap gesture |
| `ultra.longPress` | Long-press gesture |
| `ultra.enterText` | Enter text into a field |
| `ultra.clearText` | Clear a text field |
| `ultra.swipe` | Swipe/drag gesture |
| `ultra.pinchZoom` | Pinch zoom gesture |
| `ultra.scrollTo` | Scroll until element is visible |
| `ultra.interactiveElements` | Discover tappable elements |
| `ultra.takeScreenshots` | Multi-view screenshot capture |
| `ultra.startScreencast` / `ultra.stopScreencast` | Live frame streaming |
| `ultra.getLogs` | Structured log collection |
| `ultra.pressBackButton` | Back navigation |
| `ultra.getVersion` | Binding version |

## License

Apache-2.0 - see [LICENSE](LICENSE).