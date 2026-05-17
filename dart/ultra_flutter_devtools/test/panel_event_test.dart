import 'package:flutter_test/flutter_test.dart';
import 'package:ultra_flutter_devtools/src/models/panel_event.dart';

void main() {
  group('PanelEvent', () {
    test('fromJson parses a tool_call event', () {
      final json = {
        'id': 'abc-123',
        'type': 'tool_call',
        'timestamp': '2026-05-17T12:04:01.000Z',
        'server': 'flutter-ultra-gesture',
        'tool': 'tap',
        'payload': {'target': 'submit_button'},
      };

      final event = PanelEvent.fromJson(json);

      expect(event.id, 'abc-123');
      expect(event.type, 'tool_call');
      expect(event.isToolCall, isTrue);
      expect(event.isError, isFalse);
      expect(event.server, 'flutter-ultra-gesture');
      expect(event.tool, 'tap');
      expect(event.payload?['target'], 'submit_button');
      expect(event.timestamp.year, 2026);
    });

    test('fromJson handles minimal event (no optional fields)', () {
      final json = {
        'id': 'def-456',
        'type': 'error',
        'timestamp': '2026-05-17T12:04:02.000Z',
      };

      final event = PanelEvent.fromJson(json);

      expect(event.id, 'def-456');
      expect(event.isError, isTrue);
      expect(event.isToolCall, isFalse);
      expect(event.server, isNull);
      expect(event.tool, isNull);
      expect(event.payload, isNull);
    });

    test('isToolResult identifies tool_result type', () {
      final event = PanelEvent(
        id: 'x',
        type: 'tool_result',
        timestamp: DateTime.now(),
      );
      expect(event.isToolResult, isTrue);
      expect(event.isToolCall, isFalse);
    });
  });
}
