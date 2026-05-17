/// Sentry-composable binding mixin for `ultra_flutter`.
///
/// Re-exports [UltraSentryCompatMixin] so that an app can mix both Ultra
/// Flutter and Sentry's `SentryWidgetsBindingMixin` into a single binding
/// class — sidestepping the historical marionette↔Sentry "must be only
/// binding" race (see plan §6.1 Path B).
///
/// ```dart
/// import 'package:flutter/widgets.dart';
/// import 'package:ultra_flutter/ultra_flutter.dart';
/// import 'package:ultra_flutter_sentry_compat/ultra_flutter_sentry_compat.dart';
///
/// class AppBinding extends WidgetsFlutterBinding
///     with UltraFlutterBinding, UltraSentryCompatMixin {}
///
/// Future<void> main() async {
///   AppBinding.ensureInitialized();
///   await SentryFlutter.init((o) { /* ... */ }, appRunner: () => runApp(MyApp()));
/// }
/// ```
library ultra_flutter_sentry_compat;

export 'src/ultra_sentry_compat_mixin.dart';
