# ultra_flutter

In-app Flutter binding mixin that exposes `ext.flutter.ultra.*` VM service extensions for the `flutter-ultra-mcp` Claude Code plugin.

**Status:** scaffold stub. Implementation owner: **wave-1 worker-B** (see plan §12, task #2).

The mixin form (rather than a custom binding class) is deliberate per plan §6.1 so it composes cleanly with `SentryWidgetsFlutterBinding`, `IntegrationTestWidgetsFlutterBinding`, and other Flutter binding stacks.

Usage (target shape — implementation pending):

```dart
class AppBinding extends WidgetsFlutterBinding with UltraFlutterBinding {}

void main() {
  if (kDebugMode) {
    AppBinding.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}
```
