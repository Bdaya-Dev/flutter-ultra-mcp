# ultra_flutter

In-app Flutter binding mixin that exposes `ext.flutter.ultra.*` VM service
extensions used by the `flutter-ultra-mcp` Claude Code plugin. AI agents
attach via the Dart VM Service and drive your app — taps, text input,
scroll, screenshots, screencast, logs, hot reload, custom RPCs — without
any flutter_driver instrumentation.

A composable fork of [`marionette_flutter`][marionette] v0.5.0 with one
critical UX win: the binding is a **mixin** (`mixin UltraFlutterBinding on
WidgetsBinding`) instead of a class, so it stacks cleanly onto other
`WidgetsFlutterBinding` subclasses (Sentry, integration_test, etc).

[marionette]: https://github.com/leancodepl/marionette_mcp

## Install

```yaml
dev_dependencies:
  ultra_flutter: ^0.0.1-dev.1
```

(Only `dev_dependencies` — the binding code is fully tree-shaken out of
release builds when guarded behind `kDebugMode`.)

## Usage

### Simple — no other custom binding

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

Future<void> main() async {
  if (kDebugMode) {
    UltraFlutterBinding.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}
```

### Composed with Sentry

Mix in `SentryWidgetsBindingMixin` directly alongside `UltraFlutterBinding`:

```dart
import 'package:flutter/widgets.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:ultra_flutter/ultra_flutter.dart';
// ignore: implementation_imports
import 'package:sentry_flutter/src/binding_wrapper.dart';

class AppBinding extends WidgetsFlutterBinding
    with SentryWidgetsBindingMixin, UltraFlutterBinding {}

Future<void> main() async {
  AppBinding.ensureInitialized();
  await SentryFlutter.init(
    (options) => options.dsn = '<your dsn>',
    appRunner: () => runApp(const MyApp()),
  );
}
```

This sidesteps the historical marionette↔Sentry "must be the only binding"
race — both instrumentations live on a single composed binding instance,
no singleton race needed.

### Configuration

```dart
UltraFlutterBinding.setUltraConfiguration(
  UltraConfiguration(
    isInteractiveWidget: (type) => type.toString() == 'MyCustomButton',
    extractText: (element) {
      final widget = element.widget;
      if (widget is MyCustomLabel) return widget.labelText;
      return null;
    },
    logCollector: PrintLogCollector(), // or LoggingLogCollector, etc.
    maxScreenshotSize: const Size(2000, 2000),
  ),
);
UltraFlutterBinding.ensureInitialized(); // or your AppBinding subclass
```

Configuration **must** be set BEFORE the binding initializes (i.e. before
the first `runApp` / `ensureInitialized`). The mixin form can't take
constructor arguments, so the static slot pattern is required.

## Extensions

See [EXTENSIONS.md](EXTENSIONS.md) for the full catalogue of
`ext.flutter.ultra.*` service extensions and how to register your own
custom ones.

## License

Apache-2.0. This is a fork of `marionette_flutter` (also Apache-2.0); see
top-level [LICENSE](../../LICENSE) and `NOTICE`.

## Status

Pre-1.0. Mixin shape stable; further extensions (`waitFor`,
`scrollUntilVisible`, hierarchical matchers) tracked in the plan §6.1
followups.
