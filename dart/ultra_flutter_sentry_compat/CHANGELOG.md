# Changelog

## 0.0.1-dev.1

Initial release.

### Added

- `UltraSentryCompatMixin` — companion mixin that exposes Sentry's
  `SentryWidgetsBindingMixin` alongside `UltraFlutterBinding` for a single
  composed binding class.
- Re-exports `SentryWidgetsBindingMixin` so consumers don't have to import
  Sentry internals themselves.

### Composition example (AC-UD1, verified by test)

```dart
class AppBinding extends WidgetsFlutterBinding
    with SentryWidgetsBindingMixin, UltraFlutterBinding, UltraSentryCompatMixin {}
```

### Path A upstream PR followup

The implementation reaches `SentryWidgetsBindingMixin` via
`// ignore: implementation_imports` because Sentry intentionally hides the
mixin behind a `show` clause on `package:sentry_flutter/sentry_flutter.dart`.
A Path-A upstream PR is tracked at `docs/UPSTREAM-SENTRY-PR.md`; when
merged we drop the implementation_imports comment with no consumer
breakage.
