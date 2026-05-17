# Changelog

## 0.0.1-dev.1

Initial fork of [`marionette_flutter`](https://github.com/leancodepl/marionette_mcp)
v0.5.0 (Apache-2.0).

### Breaking changes vs marionette

- Binding is now a **mixin** (`mixin UltraFlutterBinding on WidgetsBinding`)
  instead of a class. Apps that need other custom bindings (Sentry,
  integration_test, etc.) compose via `extends WidgetsFlutterBinding with
  ...`. The convenience `UltraFlutterBinding.ensureInitialized()` covers
  the no-composition case.
- Service extensions are now under `ext.flutter.ultra.*` instead of
  `ext.flutter.marionette.*`.
- `MarionetteBinding` → `UltraFlutterBinding`, `MarionetteConfiguration`
  → `UltraConfiguration`, `MarionetteExtensionResult` →
  `UltraExtensionResult`, `registerMarionetteExtension` →
  `registerUltraExtension`.

### Added

- `ext.flutter.ultra.clearText` — convenience wrapper around
  `enterText('')`, saves agents two round-trips.
- `ultra_flutter_sentry_compat` companion package for cleanly composing
  with `SentryWidgetsBindingMixin`.

### Test coverage

- 6 binding/configuration tests new for the mixin form.
- 91 ported marionette service tests pass unchanged after the rename
  pass.
- Full suite: 97/97 green on Flutter stable.
