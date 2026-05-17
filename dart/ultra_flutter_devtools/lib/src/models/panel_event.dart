/// Structured event received from the flutter-ultra-devtools MCP server.
class PanelEvent {
  PanelEvent({
    required this.id,
    required this.type,
    required this.timestamp,
    this.server,
    this.tool,
    this.payload,
  });

  factory PanelEvent.fromJson(Map<String, dynamic> json) {
    return PanelEvent(
      id: json['id'] as String,
      type: json['type'] as String,
      timestamp: DateTime.parse(json['timestamp'] as String),
      server: json['server'] as String?,
      tool: json['tool'] as String?,
      payload: json['payload'] as Map<String, dynamic>?,
    );
  }

  final String id;
  final String type;
  final DateTime timestamp;
  final String? server;
  final String? tool;
  final Map<String, dynamic>? payload;

  bool get isError => type == 'error';
  bool get isToolCall => type == 'tool_call';
  bool get isToolResult => type == 'tool_result';
}
