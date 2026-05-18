import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:ultra_flutter/src/binding/register_extension_internal.dart';
import 'package:ultra_flutter/src/binding/ultra_configuration.dart';
import 'package:ultra_flutter/src/binding/ultra_extension_result.dart';
import 'package:ultra_flutter/src/binding/register_extension.dart';
import 'package:ultra_flutter/src/services/create_screencast_server.dart';
import 'package:ultra_flutter/src/services/element_tree_finder.dart';
import 'package:ultra_flutter/src/services/gesture_dispatcher.dart';
import 'package:ultra_flutter/src/services/log_store.dart';
import 'package:ultra_flutter/src/services/screencast_server.dart';
import 'package:ultra_flutter/src/services/screencast_service.dart';
import 'package:ultra_flutter/src/services/screenshot_service.dart';
import 'package:ultra_flutter/src/services/scroll_simulator.dart';
import 'package:ultra_flutter/src/services/text_input_simulator.dart';
import 'package:ultra_flutter/src/services/widget_finder.dart';
import 'package:ultra_flutter/src/services/widget_matcher.dart';
import 'package:ultra_flutter/src/version.g.dart' as v;

/// Mixin form of the Ultra Flutter binding.
///
/// Unlike marionette's [WidgetsFlutterBinding] subclass — which had to be the
/// *only* binding in the process — this mixin composes onto any existing
/// [WidgetsFlutterBinding] subclass:
///
/// ```dart
/// class AppBinding extends WidgetsFlutterBinding with UltraFlutterBinding {}
///
/// void main() {
///   if (kDebugMode) {
///     UltraFlutterBinding.ensureInitialized();
///   } else {
///     WidgetsFlutterBinding.ensureInitialized();
///   }
///   runApp(const MyApp());
/// }
/// ```
///
/// For Sentry composition, mix in `SentryWidgetsBindingMixin` directly:
///
/// ```dart
/// // ignore: implementation_imports
/// import 'package:sentry_flutter/src/binding_wrapper.dart';
///
/// class AppBinding extends WidgetsFlutterBinding
///     with SentryWidgetsBindingMixin, UltraFlutterBinding {}
/// ```
///
/// Configuration is delivered via the static [setUltraConfiguration] before
/// the binding initializes, so that [initInstances] has the values when it
/// builds services. The convenience [ensureInitialized] both stores the
/// configuration and triggers binding construction.
// `on WidgetsBinding` (not `WidgetsFlutterBinding`) so the mixin composes
// with the test bindings too (`AutomatedTestWidgetsFlutterBinding` and
// `LiveTestWidgetsFlutterBinding` both extend `WidgetsBinding` directly).
// This matches Sentry's `SentryWidgetsBindingMixin on WidgetsBinding`.
// Production usage `extends WidgetsFlutterBinding with UltraFlutterBinding`
// still works because `WidgetsFlutterBinding` IS-A `WidgetsBinding`.
mixin UltraFlutterBinding on WidgetsBinding {
  /// The active configuration for this binding.
  ///
  /// Set indirectly via [setUltraConfiguration] before
  /// [WidgetsFlutterBinding.ensureInitialized] runs. Defaults to a
  /// const [UltraConfiguration] if no value was provided.
  UltraConfiguration get configuration => _configuration;
  late final UltraConfiguration _configuration;

  // ------------------------------------------------------------------
  // Static glue: pending configuration + simple ensureInitialized()
  // ------------------------------------------------------------------

  static UltraConfiguration? _pendingConfiguration;
  static UltraFlutterBinding? _instance;

  /// Stashes [configuration] so the next binding construction picks it up.
  ///
  /// Call this BEFORE [WidgetsFlutterBinding.ensureInitialized] runs (which
  /// happens implicitly inside [ensureInitialized]).
  static void setUltraConfiguration(UltraConfiguration configuration) {
    _pendingConfiguration = configuration;
  }

  /// Returns the active [UltraFlutterBinding] instance.
  ///
  /// Throws if no binding has been initialized yet, or if the active
  /// [WidgetsFlutterBinding] does not include this mixin.
  static UltraFlutterBinding get instance =>
      BindingBase.checkInstance(_instance);

  /// Convenience initialiser for apps that don't need to compose with other
  /// bindings (e.g. Sentry). Equivalent to:
  ///
  /// ```dart
  /// class _DefaultBinding extends WidgetsFlutterBinding with UltraFlutterBinding {}
  /// _DefaultBinding.ensureInitialized();
  /// ```
  ///
  /// If a different [WidgetsFlutterBinding] subclass has already been
  /// initialized in this process (e.g. Sentry's), this call asserts in debug
  /// and falls back to that binding in release — the recommended path in that
  /// situation is to define your own composed class as documented above.
  static UltraFlutterBinding ensureInitialized([
    UltraConfiguration configuration = const UltraConfiguration(),
  ]) {
    setUltraConfiguration(configuration);
    if (_instance == null) {
      _UltraFlutterDefaultBinding.ensureInitialized();
    }
    return instance;
  }

  // ------------------------------------------------------------------
  // Service instances — late so subclasses with extra binding mixins still
  // get the same lifecycle.
  // ------------------------------------------------------------------

  late final ElementTreeFinder _elementTreeFinder;
  late final GestureDispatcher _gestureDispatcher;
  LogStore? _logStore;
  late final ScreenshotService _screenshotService;
  late final ScrollSimulator _scrollSimulator;
  late final TextInputSimulator _textInputSimulator;
  late final ScreencastServer _screencastServer;
  late final WidgetFinder _widgetFinder;

  @override
  void initInstances() {
    super.initInstances();
    _configuration = _pendingConfiguration ?? const UltraConfiguration();
    _pendingConfiguration = null;
    _instance = this;

    _widgetFinder = WidgetFinder();
    _elementTreeFinder = ElementTreeFinder(_configuration);
    _gestureDispatcher = GestureDispatcher();
    _screenshotService = ScreenshotService(
      maxScreenshotSize: _configuration.maxScreenshotSize,
    );
    _screencastServer = createScreencastServer(
      screencastServiceFactory: ({Size? maxSize}) =>
          ScreencastService(maxSize: maxSize),
      viewportSizeProvider: () {
        final renderView = renderViews.firstOrNull;
        return renderView?.flutterView.physicalSize ?? Size.zero;
      },
    );
    _scrollSimulator = ScrollSimulator(_gestureDispatcher, _widgetFinder);
    _textInputSimulator = TextInputSimulator(_widgetFinder);

    if (_configuration.logCollector != null) {
      _logStore = LogStore();
      _configuration.logCollector!.start(_logStore!.add);
    }
  }

  @override
  void initServiceExtensions() {
    super.initServiceExtensions();

    registerInternalUltraExtension(
      name: 'ultra.getVersion',
      callback: (params) async {
        return UltraExtensionResult.success({'version': v.version});
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.interactiveElements',
      callback: (params) async {
        final elements = _elementTreeFinder.findInteractiveElements();
        return UltraExtensionResult.success({'elements': elements});
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.tap',
      callback: (params) async {
        final matcher = WidgetMatcher.fromJson(params);
        await _gestureDispatcher.tap(matcher, _widgetFinder, _configuration);
        return UltraExtensionResult.success({
          'message': 'Tapped element matching: ${matcher.toJson()}',
        });
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.doubleTap',
      callback: (params) async {
        final matcher = WidgetMatcher.fromJson(params);
        final delay = _parsePositiveDuration(
              params['delay'],
              parameter: 'delay',
            ) ??
            const Duration(milliseconds: 100);

        await _gestureDispatcher.doubleTap(
          matcher,
          _widgetFinder,
          _configuration,
          delay: delay,
        );

        return UltraExtensionResult.success({
          'message': 'Double tapped element matching: ${matcher.toJson()}',
        });
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.longPress',
      callback: (params) async {
        final matcher = WidgetMatcher.fromJson(params);
        final duration = _parseDuration(
              params['duration'],
              parameter: 'duration',
            ) ??
            const Duration(milliseconds: 600);

        await _gestureDispatcher.longPress(
          matcher,
          _widgetFinder,
          _configuration,
          duration: duration,
        );

        return UltraExtensionResult.success({
          'message': 'Long pressed element matching: ${matcher.toJson()}',
        });
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.enterText',
      callback: (params) async {
        final matcher = WidgetMatcher.fromJson(params);
        final input = params['input'];

        if (input == null) {
          return UltraExtensionResult.invalidParams(
            'Missing required parameter: input',
          );
        }

        await _textInputSimulator.enterText(matcher, input, _configuration);

        return UltraExtensionResult.success({
          'message': 'Entered text into element matching: ${matcher.toJson()}',
        });
      },
    );

    // Enhancement over marionette: dedicated clearText extension.
    registerInternalUltraExtension(
      name: 'ultra.clearText',
      callback: (params) async {
        final matcher = WidgetMatcher.fromJson(params);
        await _textInputSimulator.enterText(matcher, '', _configuration);
        return UltraExtensionResult.success({
          'message': 'Cleared text in element matching: ${matcher.toJson()}',
        });
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.swipe',
      callback: (params) async {
        if (params.containsKey('startX')) {
          final startXStr = params['startX'];
          final startYStr = params['startY'];
          final endXStr = params['endX'];
          final endYStr = params['endY'];

          if (startXStr == null ||
              startYStr == null ||
              endXStr == null ||
              endYStr == null) {
            return UltraExtensionResult.invalidParams(
              'Coordinate-based swipe requires all of: '
              'startX, startY, endX, endY',
            );
          }

          final startX = double.tryParse(startXStr);
          final startY = double.tryParse(startYStr);
          final endX = double.tryParse(endXStr);
          final endY = double.tryParse(endYStr);

          if (startX == null ||
              startY == null ||
              endX == null ||
              endY == null) {
            return UltraExtensionResult.invalidParams(
              'Invalid coordinate values. '
              'startX, startY, endX, endY must be valid numbers.',
            );
          }

          await _gestureDispatcher.drag(
            Offset(startX, startY),
            Offset(endX, endY),
          );

          return UltraExtensionResult.success({
            'message': 'Swiped from ($startX, $startY) to ($endX, $endY)',
          });
        }

        final matcher = WidgetMatcher.fromJson(params);
        final direction = params['direction'];
        if (direction == null) {
          return UltraExtensionResult.invalidParams(
            'Missing required parameter: direction '
            '(must be one of: left, right, up, down)',
          );
        }

        final distanceStr = params['distance'];
        final double distance;
        if (distanceStr != null) {
          final parsed = double.tryParse(distanceStr);
          if (parsed == null) {
            return UltraExtensionResult.invalidParams(
              'Invalid distance value: "$distanceStr". '
              'Must be a valid number.',
            );
          }
          distance = parsed;
        } else {
          distance = 200.0;
        }

        await _gestureDispatcher.swipe(
          matcher,
          _widgetFinder,
          _configuration,
          direction: direction,
          distance: distance,
        );

        return UltraExtensionResult.success({
          'message':
              'Swiped $direction on element matching: ${matcher.toJson()}',
        });
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.pinchZoom',
      callback: (params) async {
        final rawScale = params['scale'];
        if (rawScale == null) {
          return UltraExtensionResult.invalidParams(
            'Missing required parameter: scale',
          );
        }
        final scale = double.tryParse(rawScale.toString());
        if (scale == null || scale <= 0) {
          return UltraExtensionResult.invalidParams(
            'Parameter "scale" must be a positive number, got "$rawScale"',
          );
        }

        final rawDistance = params['startDistance'];
        double startDistance = 200.0;
        if (rawDistance != null) {
          final parsed = double.tryParse(rawDistance.toString());
          if (parsed == null || parsed <= 0) {
            return UltraExtensionResult.invalidParams(
              'Parameter "startDistance" must be a positive number, '
              'got "$rawDistance"',
            );
          }
          startDistance = parsed;
        }

        final WidgetMatcher matcher;
        try {
          matcher = WidgetMatcher.fromJson(params);
        } on ArgumentError {
          return UltraExtensionResult.invalidParams(
            'Missing required selector: provide "key", "text", "type", '
            'or "x" & "y" coordinates.',
          );
        }

        await _gestureDispatcher.pinchZoom(
          matcher,
          _widgetFinder,
          _configuration,
          scale: scale,
          startDistance: startDistance,
        );

        return UltraExtensionResult.success({
          'message': 'Pinch zoomed (scale: $scale) on element matching: '
              '${matcher.toJson()}',
        });
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.scrollTo',
      callback: (params) async {
        final matcher = WidgetMatcher.fromJson(params);
        await _scrollSimulator.scrollUntilVisible(matcher, _configuration);
        return UltraExtensionResult.success({
          'message': 'Scrolled to element matching: ${matcher.toJson()}',
        });
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.getLogs',
      callback: (params) async {
        if (_logStore == null) {
          return UltraExtensionResult.error(
            0,
            'Log collection is not configured. Pass an UltraConfiguration with a '
            'logCollector when calling UltraFlutterBinding.ensureInitialized — '
            'e.g. LoggingLogCollector from package:ultra_flutter_logging or '
            'PrintLogCollector (built-in). See README for examples.',
          );
        }

        final logs = _logStore!.getLogs();
        return UltraExtensionResult.success({
          'logs': logs,
          'count': logs.length,
        });
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.takeScreenshots',
      callback: (params) async {
        final screenshots = await _screenshotService.takeScreenshots();
        return UltraExtensionResult.success({'screenshots': screenshots});
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.startScreencast',
      callback: (params) async {
        try {
          final maxWidth = int.tryParse(params['maxWidth'] ?? '');
          final maxHeight = int.tryParse(params['maxHeight'] ?? '');
          final wsPort = int.tryParse(params['wsPort'] ?? '');

          final result = await _screencastServer.startScreencast(
            maxWidth: maxWidth,
            maxHeight: maxHeight,
            wsPort: wsPort,
          );
          return UltraExtensionResult.success(result);
        } on StateError catch (e) {
          return UltraExtensionResult.error(0, e.message);
        }
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.stopScreencast',
      callback: (params) async {
        await _screencastServer.stopScreencast();
        return UltraExtensionResult.success({'message': 'Screencast stopped'});
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.pressBackButton',
      callback: (params) async {
        final didPop = await handlePopRoute();
        return UltraExtensionResult.success({
          'didPop': didPop,
          'message': didPop
              ? 'Back button pressed, route was popped'
              : 'Back button pressed, no route to pop (app may exit)',
        });
      },
    );

    registerInternalUltraExtension(
      name: 'ultra.listExtensions',
      callback: (params) async {
        return UltraExtensionResult.success({
          'extensions': [
            for (final ext in customExtensionRegistry)
              {
                'name': ext.name,
                if (ext.description != null) 'description': ext.description,
              },
          ],
        });
      },
    );
  }

  @override
  Future<void> reassembleApplication() async {
    _logStore?.clear();
    await _screencastServer.stopScreencast();
    return super.reassembleApplication();
  }

  // ------------------------------------------------------------------

  static Duration? _parseDuration(
    String? raw, {
    required String parameter,
  }) {
    if (raw == null) return null;
    final ms = int.tryParse(raw);
    if (ms == null) {
      throw ArgumentError.value(
        raw,
        parameter,
        'must be a number (milliseconds)',
      );
    }
    return Duration(milliseconds: ms);
  }

  static Duration? _parsePositiveDuration(
    String? raw, {
    required String parameter,
  }) {
    if (raw == null) return null;
    final ms = int.tryParse(raw);
    if (ms == null || ms <= 0) {
      throw ArgumentError.value(
        raw,
        parameter,
        'must be a positive number (milliseconds)',
      );
    }
    return Duration(milliseconds: ms);
  }
}

/// Default binding used by [UltraFlutterBinding.ensureInitialized] when the
/// user does not provide their own composed binding class.
class _UltraFlutterDefaultBinding extends WidgetsFlutterBinding
    with UltraFlutterBinding {
  static WidgetsBinding ensureInitialized() {
    if (WidgetsBinding.instance is! _UltraFlutterDefaultBinding) {
      _UltraFlutterDefaultBinding();
    }
    return WidgetsBinding.instance;
  }
}
