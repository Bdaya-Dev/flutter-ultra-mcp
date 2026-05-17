import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ultra_flutter/ultra_flutter.dart';
import 'package:ultra_flutter_sentry_compat/ultra_flutter_sentry_compat.dart';

/// AC-UD1 example: this binding class MUST compile and initialize without
/// throwing the historical "must be the only binding" assertion that
/// marionette had.
///
/// Composed onto [AutomatedTestWidgetsFlutterBinding] rather than
/// [WidgetsFlutterBinding] because the test harness needs the automated
/// variant. In production code the same pattern composes onto
/// `WidgetsFlutterBinding`:
///
/// ```dart
/// class AppBinding extends WidgetsFlutterBinding
///     with UltraFlutterBinding, UltraSentryCompatMixin {}
/// ```
class TestAppBinding extends AutomatedTestWidgetsFlutterBinding
    with SentryWidgetsBindingMixin, UltraFlutterBinding, UltraSentryCompatMixin {
  static TestAppBinding ensureInitialized() {
    // Catch-and-construct pattern — matches the canonical Flutter recipe
    // used by `WidgetsFlutterBinding.ensureInitialized` itself.
    try {
      return WidgetsBinding.instance as TestAppBinding;
    } catch (_) {
      TestAppBinding();
      return WidgetsBinding.instance as TestAppBinding;
    }
  }
}

void main() {
  // Plan §6.1 AC-UD1: ship a tested composition example.
  // Asserts:
  //   - The class compiles (build-time)
  //   - The binding initializes without `BindingBase.checkInstance`
  //     assertion errors
  //   - Both mixins coexist on the same active WidgetsBinding instance
  //   - The ultra extension registry + Sentry frame-timing APIs are
  //     reachable on that one binding
  TestAppBinding.ensureInitialized();

  group('UltraFlutterBinding + UltraSentryCompatMixin composition', () {
    test('composed binding is the active WidgetsBinding instance', () {
      expect(WidgetsBinding.instance, isA<TestAppBinding>());
      expect(WidgetsBinding.instance, isA<UltraFlutterBinding>());
      expect(WidgetsBinding.instance, isA<SentryWidgetsBindingMixin>());
    });

    test('UltraFlutterBinding.instance getter returns the composed binding',
        () {
      expect(UltraFlutterBinding.instance, same(WidgetsBinding.instance));
    });

    test('Sentry frame-timing APIs are reachable on the composed binding',
        () {
      final binding = WidgetsBinding.instance as SentryWidgetsBindingMixin;
      // Calling pause/resume should be a no-op without options wired but
      // must not throw — proves the mixin's state is initialised.
      expect(
        () {
          binding.pauseTrackingFrames();
          binding.resumeTrackingFrames();
        },
        returnsNormally,
      );
    });

    test('Ultra configuration accessible on the composed binding', () {
      final ultra = WidgetsBinding.instance as UltraFlutterBinding;
      expect(ultra.configuration, isA<UltraConfiguration>());
    });

    test('listExtensions custom registry is reachable', () {
      // Confirms the ultra extension registry is wired even when Sentry's
      // mixin is composed alongside.
      expect(customExtensionRegistry, isA<List>());
    });
  });
}
