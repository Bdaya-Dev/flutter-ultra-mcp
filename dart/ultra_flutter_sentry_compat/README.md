# ultra_flutter_sentry_compat

Sentry-composable binding mixin for [`ultra_flutter`](../ultra_flutter).

Use this companion package when your app already runs Sentry. It re-exposes
Sentry's `SentryWidgetsBindingMixin` alongside an `UltraSentryCompatMixin`
shim so you can build one composed binding instead of fighting the
"only-one-binding" race:

```dart
import 'package:flutter/widgets.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:ultra_flutter/ultra_flutter.dart';
import 'package:ultra_flutter_sentry_compat/ultra_flutter_sentry_compat.dart';

class AppBinding extends WidgetsFlutterBinding
    with SentryWidgetsBindingMixin, UltraFlutterBinding, UltraSentryCompatMixin {}

Future<void> main() async {
  AppBinding.ensureInitialized();
  await SentryFlutter.init(
    (options) => options.dsn = '<your dsn>',
    appRunner: () => runApp(const MyApp()),
  );
}
```

After `AppBinding.ensureInitialized()`:

- `WidgetsBinding.instance` is the composed `AppBinding`.
- `UltraFlutterBinding.instance` is the same instance — all
  `ext.flutter.ultra.*` extensions register normally.
- Sentry's frame-timing instrumentation, `captureException`, breadcrumbs,
  navigation tracing, etc. all work.
- No race condition: there is exactly one `WidgetsBinding` initialised.

## Why a companion package?

`sentry_flutter` exports `SentryWidgetsFlutterBinding` (a class extending
`WidgetsFlutterBinding`) but the underlying `SentryWidgetsBindingMixin` is
hidden by the `show` clause on its public library. We reach the mixin via
a deliberate `// ignore: implementation_imports` import of
`package:sentry_flutter/src/binding_wrapper.dart` and re-export it as a
stable symbol from this package — so your code depends only on
`ultra_flutter_sentry_compat`, not on Sentry internals.

A Path A upstream PR to Sentry (make `SentryWidgetsBindingMixin` part of
the public API) is tracked in
[`docs/UPSTREAM-SENTRY-PR.md`](../../docs/UPSTREAM-SENTRY-PR.md). When it
merges this package drops the implementation_imports comment without any
consumer-facing change.

## Versioning

`ultra_flutter_sentry_compat` follows the same release cadence as
`ultra_flutter`. Bumps the Sentry constraint when verified compatible with
a newer `sentry_flutter` major.

## License

Apache-2.0. See top-level [LICENSE](../../LICENSE) and `NOTICE`.
