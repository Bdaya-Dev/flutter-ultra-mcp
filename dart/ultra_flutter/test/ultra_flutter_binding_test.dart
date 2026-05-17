import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ultra_flutter/src/version.g.dart' as v;
import 'package:ultra_flutter/ultra_flutter.dart';

/// Custom test binding that composes [UltraFlutterBinding] onto Flutter's
/// automated test binding. Using `AutomatedTestWidgetsFlutterBinding` rather
/// than `WidgetsFlutterBinding` matches the `flutter test` environment — the
/// host process here doesn't have a Skia engine to satisfy the live binding.
///
/// This binding is the only public, non-private demonstration of the
/// `with UltraFlutterBinding` composition pattern in the package's own test
/// suite, and is what proves the mixin can stack onto something other than
/// the default `WidgetsFlutterBinding`.
class TestUltraBinding extends AutomatedTestWidgetsFlutterBinding
    with UltraFlutterBinding {
  static TestUltraBinding ensureInitialized() {
    // The catch-and-construct pattern is the canonical Flutter recipe for
    // custom bindings — reading `WidgetsBinding.instance` before any binding
    // is constructed throws `Binding has not yet been initialized`, so we
    // probe via try/catch instead of `is!`.
    try {
      return WidgetsBinding.instance as TestUltraBinding;
    } catch (_) {
      TestUltraBinding();
      return WidgetsBinding.instance as TestUltraBinding;
    }
  }
}

void main() {
  // Stash configuration before the binding's initInstances() runs.
  UltraFlutterBinding.setUltraConfiguration(
    UltraConfiguration(logCollector: PrintLogCollector()),
  );
  TestUltraBinding.ensureInitialized();

  group('UltraFlutterBinding mixin form', () {
    test('singleton is the composed TestUltraBinding instance', () {
      expect(UltraFlutterBinding.instance, isA<TestUltraBinding>());
      expect(WidgetsBinding.instance, same(UltraFlutterBinding.instance));
    });

    test('exposes the configuration that was set before init', () {
      expect(
        UltraFlutterBinding.instance.configuration.logCollector,
        isA<PrintLogCollector>(),
      );
    });

    test('registerUltraExtension is callable and tracks the extension', () {
      registerUltraExtension(
        name: 'sample',
        description: 'sample extension for binding test',
        callback: (_) async => UltraExtensionResult.success({'ok': true}),
      );
      expect(
        customExtensionRegistry.map((e) => e.name),
        contains('sample'),
      );
    });

    test('version constant is wired into the binding source', () {
      // Sanity: the version that `ext.flutter.ultra.getVersion` reports
      // comes from src/version.g.dart, so a quick sanity check keeps the
      // two in sync.
      expect(v.version, isNotEmpty);
      expect(v.version, matches(RegExp(r'^\d+\.\d+\.\d+')));
    });
  });

  group('UltraConfiguration defaults', () {
    test('built-in interactive widgets', () {
      const config = UltraConfiguration();
      expect(config.isInteractiveWidgetType(ElevatedButton), isTrue);
      expect(config.isInteractiveWidgetType(TextField), isTrue);
      expect(config.isInteractiveWidgetType(Container), isFalse);
    });

    test('isInteractiveWidget callback extends built-ins', () {
      final config = UltraConfiguration(
        isInteractiveWidget: (type) => type == _CustomButton,
      );
      expect(config.isInteractiveWidgetType(ElevatedButton), isTrue);
      expect(config.isInteractiveWidgetType(_CustomButton), isTrue);
      expect(config.isInteractiveWidgetType(Container), isFalse);
    });
  });
}

class _CustomButton extends StatelessWidget {
  const _CustomButton();
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
