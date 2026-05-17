/// In-app Flutter binding mixin that exposes `ext.flutter.ultra.*` VM service
/// extensions used by the `flutter-ultra-mcp` Claude Code plugin (gesture,
/// screenshot, inspector, screencast, log collection).
///
/// See `README.md` for the composition guide and the
/// `ultra_flutter_sentry_compat` companion package for Sentry interop.
library ultra_flutter;

export 'src/binding/register_extension.dart';
export 'src/binding/ultra_configuration.dart';
export 'src/binding/ultra_extension_result.dart';
export 'src/binding/ultra_flutter_binding.dart';
export 'src/services/log_collector.dart';
export 'src/services/log_store.dart';
export 'src/services/print_log_collector.dart';
export 'src/services/screenshot_service.dart';
export 'src/services/widget_matcher.dart';
