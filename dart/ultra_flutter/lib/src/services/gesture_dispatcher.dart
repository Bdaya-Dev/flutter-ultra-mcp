import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import 'package:ultra_flutter/src/binding/ultra_configuration.dart';
import 'package:ultra_flutter/src/services/widget_finder.dart';
import 'package:ultra_flutter/src/services/widget_matcher.dart';

/// Dispatches gesture events to simulate user interactions.
class GestureDispatcher {
  static const kMaxDelta = 40.0;
  static const kDelay = Duration(milliseconds: 10);

  static const _kDeviceId = 1;
  static const _kSecondDeviceId = 2;

  int _nextPointerId = 1;

  /// Simulates a tap on an element that matches the given [matcher].
  ///
  /// If [matcher] is a [CoordinatesMatcher], taps directly at the specified
  /// coordinates without searching the widget tree (fast path).
  Future<void> tap(
    WidgetMatcher matcher,
    WidgetFinder widgetFinder,
    UltraConfiguration configuration,
  ) async {
    // Fast path for coordinate-based tapping
    if (matcher is CoordinatesMatcher) {
      await _dispatchTapAtPosition(matcher.offset);
      return;
    }

    final element = widgetFinder.findHittableElement(matcher, configuration);

    if (element == null) {
      throw Exception('Element matching ${matcher.toJson()} not found');
    } else {
      await _dispatchTapAtElement(element);
    }
  }

  Future<void> _dispatchTapAtElement(Element element) async {
    final renderObject = element.renderObject;

    if (renderObject is! RenderBox) {
      throw Exception('Element does not have a RenderBox');
    }

    if (!renderObject.hasSize) {
      throw Exception('RenderBox does not have a size yet');
    }

    // Get the center position of the widget
    final center = renderObject.size.center(Offset.zero);
    final globalPosition = renderObject.localToGlobal(center);

    await _dispatchTapAtPosition(globalPosition);
  }

  Future<void> _dispatchTapAtPosition(Offset globalPosition) async {
    final pointerId = _nextPointerId++;

    // Build the event records
    final records = [
      // Pointer down immediately
      [
        PointerAddedEvent(position: globalPosition, device: _kDeviceId),
        PointerDownEvent(
            pointer: pointerId, position: globalPosition, device: _kDeviceId),
      ],
      // Pointer up after a short delay, then remove the device
      [
        PointerUpEvent(
            pointer: pointerId, position: globalPosition, device: _kDeviceId),
        PointerRemovedEvent(position: globalPosition, device: _kDeviceId),
      ],
    ];

    await _handlePointerEventRecord(records);
  }

  /// Simulates a double tap on an element that matches the given [matcher].
  ///
  /// Two taps are dispatched with [delay] between them.
  /// Defaults to 100ms, which is within Flutter's double-tap recognition
  /// window (kDoubleTapMinTime 40ms — kDoubleTapTimeout 300ms).
  Future<void> doubleTap(
    WidgetMatcher matcher,
    WidgetFinder widgetFinder,
    UltraConfiguration configuration, {
    Duration delay = const Duration(milliseconds: 100),
  }) async {
    if (delay.isNegative || delay == Duration.zero) {
      throw ArgumentError('delay must be positive');
    }

    if (matcher is CoordinatesMatcher) {
      await _dispatchDoubleTapAtPosition(matcher.offset, delay);
      return;
    }

    final element = widgetFinder.findHittableElement(matcher, configuration);

    if (element == null) {
      throw Exception('Element matching ${matcher.toJson()} not found');
    } else {
      await _dispatchDoubleTapAtElement(element, delay);
    }
  }

  Future<void> _dispatchDoubleTapAtElement(
    Element element,
    Duration delay,
  ) async {
    final renderObject = element.renderObject;

    if (renderObject is! RenderBox) {
      throw Exception('Element does not have a RenderBox');
    }

    if (!renderObject.hasSize) {
      throw Exception('RenderBox does not have a size yet');
    }

    final center = renderObject.size.center(Offset.zero);
    final globalPosition = renderObject.localToGlobal(center);

    await _dispatchDoubleTapAtPosition(globalPosition, delay);
  }

  Future<void> _dispatchDoubleTapAtPosition(
    Offset globalPosition,
    Duration delay,
  ) async {
    // First tap
    await _dispatchTapAtPosition(globalPosition);

    // Wait between taps for double-tap recognition
    await Future<void>.delayed(delay);

    // Second tap
    await _dispatchTapAtPosition(globalPosition);
  }

  /// Simulates a long press on an element that matches the given [matcher].
  ///
  /// The pointer is held down for [duration] before being released.
  /// Defaults to 600ms (kLongPressTimeout + kPressTimeout), matching
  /// Flutter's [WidgetTester.longPress] behavior.
  Future<void> longPress(
    WidgetMatcher matcher,
    WidgetFinder widgetFinder,
    UltraConfiguration configuration, {
    Duration duration = const Duration(milliseconds: 600),
  }) async {
    if (duration.isNegative || duration == Duration.zero) {
      throw ArgumentError('duration must be positive');
    }

    if (matcher is CoordinatesMatcher) {
      await _dispatchLongPressAtPosition(matcher.offset, duration);
      return;
    }

    final element = widgetFinder.findHittableElement(matcher, configuration);

    if (element == null) {
      throw Exception('Element matching ${matcher.toJson()} not found');
    } else {
      await _dispatchLongPressAtElement(element, duration);
    }
  }

  Future<void> _dispatchLongPressAtElement(
    Element element,
    Duration duration,
  ) async {
    final renderObject = element.renderObject;

    if (renderObject is! RenderBox) {
      throw Exception('Element does not have a RenderBox');
    }

    if (!renderObject.hasSize) {
      throw Exception('RenderBox does not have a size yet');
    }

    final center = renderObject.size.center(Offset.zero);
    final globalPosition = renderObject.localToGlobal(center);

    await _dispatchLongPressAtPosition(globalPosition, duration);
  }

  Future<void> _dispatchLongPressAtPosition(
    Offset globalPosition,
    Duration duration,
  ) async {
    final pointerId = _nextPointerId++;

    final records = [
      [
        PointerAddedEvent(position: globalPosition, device: _kDeviceId),
        PointerDownEvent(
            pointer: pointerId, position: globalPosition, device: _kDeviceId),
      ],
    ];

    // Dispatch pointer down
    await _handlePointerEventRecord(records);

    // Hold for the specified duration to trigger long press recognition
    await Future<void>.delayed(duration);

    // Release
    await _handlePointerEventRecord([
      [
        PointerUpEvent(
            pointer: pointerId, position: globalPosition, device: _kDeviceId),
        PointerRemovedEvent(position: globalPosition, device: _kDeviceId),
      ],
    ]);
  }

  /// Simulates a swipe gesture on an element matching [matcher] in the given
  /// [direction] for [distance] pixels.
  ///
  /// The swipe starts from the center of the matched element and moves in the
  /// specified direction.
  Future<void> swipe(
    WidgetMatcher matcher,
    WidgetFinder widgetFinder,
    UltraConfiguration configuration, {
    required String direction,
    double distance = 200.0,
  }) async {
    final element = widgetFinder.findElement(matcher, configuration);

    if (element == null) {
      throw Exception('Element matching ${matcher.toJson()} not found');
    }

    final renderObject = element.renderObject;
    if (renderObject is! RenderBox) {
      throw Exception('Element does not have a RenderBox');
    }

    if (!renderObject.hasSize) {
      throw Exception('RenderBox does not have a size yet');
    }

    final center = renderObject.size.center(Offset.zero);
    final start = renderObject.localToGlobal(center);

    final end = switch (direction) {
      'left' => start + Offset(-distance, 0),
      'right' => start + Offset(distance, 0),
      'up' => start + Offset(0, -distance),
      'down' => start + Offset(0, distance),
      _ => throw ArgumentError('Invalid direction: $direction. '
          'Must be one of: left, right, up, down'),
    };

    await drag(start, end);
  }

  /// Simulates a pinch zoom gesture centered on an element matching [matcher].
  ///
  /// [scale] controls the zoom:
  /// - scale > 1.0: zoom in (fingers move apart)
  /// - scale < 1.0: zoom out (fingers move together)
  ///
  /// [startDistance] is the initial distance between the two fingers in pixels.
  Future<void> pinchZoom(
    WidgetMatcher matcher,
    WidgetFinder widgetFinder,
    UltraConfiguration configuration, {
    required double scale,
    double startDistance = 200.0,
  }) async {
    if (scale <= 0) {
      throw ArgumentError('scale must be positive');
    }
    if (startDistance <= 0) {
      throw ArgumentError('startDistance must be positive');
    }

    if (matcher is CoordinatesMatcher) {
      await _dispatchPinchZoomAtPosition(
        matcher.offset,
        scale: scale,
        startDistance: startDistance,
      );
      return;
    }

    final element = widgetFinder.findHittableElement(matcher, configuration);

    if (element == null) {
      throw Exception('Element matching ${matcher.toJson()} not found');
    }

    final renderObject = element.renderObject;
    if (renderObject is! RenderBox) {
      throw Exception('Element does not have a RenderBox');
    }

    if (!renderObject.hasSize) {
      throw Exception('RenderBox does not have a size yet');
    }

    final center = renderObject.size.center(Offset.zero);
    final globalCenter = renderObject.localToGlobal(center);

    await _dispatchPinchZoomAtPosition(
      globalCenter,
      scale: scale,
      startDistance: startDistance,
    );
  }

  Future<void> _dispatchPinchZoomAtPosition(
    Offset center, {
    required double scale,
    required double startDistance,
  }) async {
    final pointer1Id = _nextPointerId++;
    final pointer2Id = _nextPointerId++;
    final endDistance = startDistance * scale;

    const stepCount = 10;

    // Finger positions: horizontally offset from center
    Offset finger1(double distance) => center - Offset(distance / 2, 0);
    Offset finger2(double distance) => center + Offset(distance / 2, 0);

    final start1 = finger1(startDistance);
    final start2 = finger2(startDistance);

    // Phase 1: Both fingers down
    final records = <List<PointerEvent>>[
      [
        PointerAddedEvent(position: start1, device: _kDeviceId),
        PointerDownEvent(
          pointer: pointer1Id,
          position: start1,
          device: _kDeviceId,
        ),
      ],
      [
        PointerAddedEvent(position: start2, device: _kSecondDeviceId),
        PointerDownEvent(
          pointer: pointer2Id,
          position: start2,
          device: _kSecondDeviceId,
        ),
      ],
    ];

    // Phase 2: Move fingers apart (zoom in) or together (zoom out)
    for (var i = 1; i <= stepCount; i++) {
      final t = i / stepCount;
      final currentDistance = startDistance + (endDistance - startDistance) * t;
      final pos1 = finger1(currentDistance);
      final pos2 = finger2(currentDistance);

      records.add([
        PointerMoveEvent(
          pointer: pointer1Id,
          position: pos1,
          device: _kDeviceId,
        ),
        PointerMoveEvent(
          pointer: pointer2Id,
          position: pos2,
          device: _kSecondDeviceId,
        ),
      ]);
    }

    // Phase 3: Both fingers up
    final end1 = finger1(endDistance);
    final end2 = finger2(endDistance);

    records.addAll([
      [
        PointerUpEvent(
          pointer: pointer1Id,
          position: end1,
          device: _kDeviceId,
        ),
        PointerUpEvent(
          pointer: pointer2Id,
          position: end2,
          device: _kSecondDeviceId,
        ),
      ],
      [
        PointerRemovedEvent(position: end1, device: _kDeviceId),
        PointerRemovedEvent(position: end2, device: _kSecondDeviceId),
      ],
    ]);

    await _handlePointerEventRecord(records);
  }

  /// Simulates a drag gesture from [from] to [to].
  Future<void> drag(Offset from, Offset to) async {
    final pointerId = _nextPointerId++;

    final delta = to - from;
    final distance = delta.distance;
    final stepCount =
        (distance / kMaxDelta).ceil().clamp(1, double.infinity).toInt();

    final moveRecords = <List<PointerEvent>>[];
    for (var i = 1; i <= stepCount; i++) {
      final t = i / stepCount;
      final position = Offset.lerp(from, to, t)!;
      final previousPosition =
          i == 1 ? from : Offset.lerp(from, to, (i - 1) / stepCount)!;
      final stepDelta = position - previousPosition;

      moveRecords.add([
        PointerMoveEvent(
          pointer: pointerId,
          position: position,
          delta: stepDelta,
          device: _kDeviceId,
        ),
      ]);
    }

    final records = [
      [
        PointerAddedEvent(position: from, device: _kDeviceId),
        PointerDownEvent(
            pointer: pointerId, position: from, device: _kDeviceId),
      ],
      ...moveRecords,
      [
        PointerUpEvent(pointer: pointerId, position: to, device: _kDeviceId),
        PointerRemovedEvent(position: to, device: _kDeviceId),
      ],
    ];

    await _handlePointerEventRecord(records);
  }

  /// Executes a W3C-style multi-touch action sequence.
  ///
  /// [actions] is a list of pointer chains. Each chain has a [pointerId] string
  /// and a list of steps:
  ///   - `{ "type": "pointerDown", "x": <num>, "y": <num> }`
  ///   - `{ "type": "pointerMove", "x": <num>, "y": <num>, "duration": <ms> }`
  ///   - `{ "type": "pointerUp" }`
  ///   - `{ "type": "pause", "duration": <ms> }`
  ///
  /// All chains advance in lock-step: tick N across every chain is dispatched
  /// as a single batched [_handlePointerEventRecord] group, matching the W3C
  /// Actions interleaving model.
  Future<void> performActions(
    List<Map<String, dynamic>> actions,
  ) async {
    // Assign a unique integer pointer id and device id per named pointer chain.
    final pointerIds = <String, int>{};
    final deviceIds = <String, int>{};
    for (final chain in actions) {
      final name = chain['pointerId'] as String;
      pointerIds[name] = _nextPointerId++;
      // Each pointer gets its own logical device id so Flutter treats them as
      // independent touch contacts.
      deviceIds[name] = _nextPointerId; // unique, never reused
    }

    // Build the per-chain tick sequences.  Each chain entry is a list of
    // (delay, events) pairs — delay in ms before emitting those events.
    final chainTicks = <List<({int delayMs, List<PointerEvent> events})>>[];

    for (final chain in actions) {
      final name = chain['pointerId'] as String;
      final pid = pointerIds[name]!;
      final did = deviceIds[name]!;
      final steps = (chain['steps'] as List).cast<Map<String, dynamic>>();

      final ticks = <({int delayMs, List<PointerEvent> events})>[];
      Offset? currentPos;

      for (final step in steps) {
        final type = step['type'] as String;
        switch (type) {
          case 'pointerDown':
            final pos = Offset(
              (step['x'] as num).toDouble(),
              (step['y'] as num).toDouble(),
            );
            currentPos = pos;
            ticks.add((
              delayMs: 0,
              events: [
                PointerAddedEvent(position: pos, device: did),
                PointerDownEvent(pointer: pid, position: pos, device: did),
              ],
            ));

          case 'pointerMove':
            final end = Offset(
              (step['x'] as num).toDouble(),
              (step['y'] as num).toDouble(),
            );
            final durationMs = (step['duration'] as num?)?.toInt() ?? 0;
            final start = currentPos ?? end;
            final distance = (end - start).distance;
            final stepCount =
                (distance / kMaxDelta).ceil().clamp(1, 1 << 20).toInt();
            final stepDelayMs =
                stepCount > 1 ? (durationMs / stepCount).round() : durationMs;

            for (var i = 1; i <= stepCount; i++) {
              final t = i / stepCount;
              final pos = Offset.lerp(start, end, t)!;
              ticks.add((
                delayMs: stepDelayMs,
                events: [
                  PointerMoveEvent(
                    pointer: pid,
                    position: pos,
                    delta: pos -
                        (i == 1
                            ? start
                            : Offset.lerp(start, end, (i - 1) / stepCount)!),
                    device: did,
                  ),
                ],
              ));
            }
            currentPos = end;

          case 'pointerUp':
            final pos = currentPos ?? Offset.zero;
            ticks.add((
              delayMs: 0,
              events: [
                PointerUpEvent(pointer: pid, position: pos, device: did),
                PointerRemovedEvent(position: pos, device: did),
              ],
            ));
            currentPos = null;

          case 'pause':
            final durationMs = (step['duration'] as num?)?.toInt() ?? 0;
            ticks.add((delayMs: durationMs, events: const []));

          default:
            throw ArgumentError('Unknown action step type: "$type"');
        }
      }

      chainTicks.add(ticks);
    }

    if (chainTicks.isEmpty) return;

    // Interleave chains tick-by-tick (W3C model: pad shorter chains with nulls).
    final maxTicks = chainTicks.fold(0, (m, c) => c.length > m ? c.length : m);

    for (var t = 0; t < maxTicks; t++) {
      // Collect the maximum delay across all chains at this tick.
      var tickDelayMs = 0;
      final batchEvents = <PointerEvent>[];

      for (final chain in chainTicks) {
        if (t >= chain.length) continue;
        final tick = chain[t];
        if (tick.delayMs > tickDelayMs) tickDelayMs = tick.delayMs;
        batchEvents.addAll(tick.events);
      }

      if (batchEvents.isNotEmpty) {
        batchEvents.forEach(GestureBinding.instance.handlePointerEvent);
        WidgetsBinding.instance.scheduleFrame();
      }

      final delay =
          tickDelayMs > 0 ? Duration(milliseconds: tickDelayMs) : kDelay;
      await Future<void>.delayed(delay);
    }
  }

  /// Handles a list of pointer event records by dispatching them with proper timing.
  ///
  /// Similar to Flutter's test framework handlePointerEventRecord, but simplified
  /// for live app execution.
  Future<void> _handlePointerEventRecord(
    List<List<PointerEvent>> records,
  ) async {
    for (final record in records) {
      record.forEach(GestureBinding.instance.handlePointerEvent);
      WidgetsBinding.instance.scheduleFrame();
      await Future<void>.delayed(kDelay);
    }
  }
}
