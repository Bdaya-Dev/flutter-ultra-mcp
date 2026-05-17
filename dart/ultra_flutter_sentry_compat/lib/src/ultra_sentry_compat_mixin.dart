import 'package:flutter/widgets.dart';

// ignore: implementation_imports
import 'package:sentry_flutter/src/binding_wrapper.dart'
    show SentryWidgetsBindingMixin;

// Re-export so consumers depend only on this package, not on Sentry internals.
export 'package:sentry_flutter/src/binding_wrapper.dart'
    show SentryWidgetsBindingMixin;

/// Composes Sentry's frame-timing instrumentation onto any
/// [WidgetsFlutterBinding] subclass that also mixes in
/// `UltraFlutterBinding`.
///
/// Usage:
///
/// ```dart
/// class AppBinding extends WidgetsFlutterBinding
///     with UltraFlutterBinding, UltraSentryCompatMixin {}
/// ```
///
/// ### Why this mixin exists
///
/// Sentry exports `SentryWidgetsFlutterBinding` as a **class**, so it cannot
/// be composed with `UltraFlutterBinding` via the `with` keyword in Dart —
/// two classes can't both extend `WidgetsFlutterBinding`. The underlying
/// `SentryWidgetsBindingMixin` *is* a mixin, but Sentry intentionally hides
/// it from the public surface (via `show` clause in
/// `sentry_flutter.dart`).
///
/// Path B (plan §6.1) is to ship this companion package that re-exposes the
/// mixin alongside our own `UltraSentryCompatMixin`. The implementation
/// import is annotated with `ignore: implementation_imports` because the
/// reach-through is deliberate and audited; we re-export the symbol so
/// consumer code depends only on `package:ultra_flutter_sentry_compat/...`
/// and not on Sentry's internals.
///
/// Path A is the open upstream PR to add `SentryWidgetsBindingMixin` to
/// `sentry_flutter.dart`'s public export. When Sentry merges it we can drop
/// the implementation import; the public API of this package does not need
/// to change.
mixin UltraSentryCompatMixin on WidgetsBinding, SentryWidgetsBindingMixin {
  // No additional state — the entire compatibility surface is provided by
  // SentryWidgetsBindingMixin. This mixin exists so consumers can rely on a
  // stable `UltraSentryCompatMixin` symbol in their `with` clauses even if
  // Sentry renames things later.
}
