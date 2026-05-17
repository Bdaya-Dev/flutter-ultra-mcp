/// Flutter DevTools extension for the flutter-ultra-mcp Claude Code plugin.
///
/// Shows: connected sessions, recent tool calls, live log stream, plugin health.
/// Connects outbound to the flutter-ultra-devtools MCP server's WebSocket.
library ultra_flutter_devtools;

export 'src/devtools_extension.dart';
export 'src/models/panel_event.dart';
export 'src/services/ws_connection.dart';
