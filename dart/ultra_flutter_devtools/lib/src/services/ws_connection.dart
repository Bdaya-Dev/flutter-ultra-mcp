import 'dart:convert';
import 'dart:js_interop';

import 'package:flutter/foundation.dart';
import 'package:web/web.dart' as web;

import '../models/panel_event.dart';

/// WebSocket connection to the flutter-ultra-devtools MCP server.
///
/// Uses `package:web` (NOT deprecated `dart:html`) for browser compatibility.
class WsConnection extends ChangeNotifier {
  WsConnection({this.defaultUrl = 'ws://127.0.0.1:9170'});

  final String defaultUrl;

  web.WebSocket? _socket;
  final List<PanelEvent> _events = [];
  String? _viewerId;
  bool _connected = false;

  bool get connected => _connected;
  String? get viewerId => _viewerId;
  List<PanelEvent> get events => List.unmodifiable(_events);
  int get eventCount => _events.length;

  static const int _maxEvents = 200;

  void connect([String? url]) {
    disconnect();
    final target = url ?? defaultUrl;
    final socket = web.WebSocket(target);
    _socket = socket;

    socket.onopen = ((web.Event event) {
      _connected = true;
      notifyListeners();
    }).toJS;

    socket.onmessage = ((web.MessageEvent event) {
      _handleMessage(event.data);
    }).toJS;

    socket.onclose = ((web.CloseEvent event) {
      _connected = false;
      _viewerId = null;
      _socket = null;
      notifyListeners();
    }).toJS;

    socket.onerror = ((web.Event event) {
      _connected = false;
      _socket = null;
      notifyListeners();
    }).toJS;
  }

  void disconnect() {
    _socket?.close(1000, 'extension closing');
    _socket = null;
    _connected = false;
    _viewerId = null;
    notifyListeners();
  }

  void sendCommand(String command, [Map<String, dynamic>? payload]) {
    if (_socket == null || !_connected) return;
    final msg = jsonEncode({
      'type': 'command',
      'payload': {'command': command, ...?payload},
    });
    _socket!.send(msg.toJS as JSAny);
  }

  void clearEvents() {
    _events.clear();
    notifyListeners();
  }

  void _handleMessage(JSAny? data) {
    if (data == null) return;
    try {
      final str = (data as JSString).toDart;
      final json = jsonDecode(str) as Map<String, dynamic>;

      if (json['type'] == 'welcome') {
        _viewerId = json['viewerId'] as String?;
        notifyListeners();
        return;
      }

      final event = PanelEvent.fromJson(json);
      _events.add(event);
      if (_events.length > _maxEvents) {
        _events.removeRange(0, _events.length - _maxEvents);
      }
      notifyListeners();
    } catch (_) {
      // Ignore malformed messages
    }
  }

  @override
  void dispose() {
    disconnect();
    super.dispose();
  }
}
