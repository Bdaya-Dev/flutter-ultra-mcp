# ultra_flutter_devtools

Flutter DevTools extension panel for the [flutter-ultra-mcp](https://github.com/Bdaya-Dev/flutter-ultra-mcp) Claude Code plugin.

Shows live MCP activity: active sessions, recent tool calls, errors, and a screenshot grid. Connects to the `flutter-ultra-devtools` MCP server via WebSocket.

## Installation

Add to your Flutter app's `pubspec.yaml`:

```yaml
dev_dependencies:
  ultra_flutter_devtools: ^0.1.0
```

The extension panel appears automatically in Flutter DevTools when the package is installed.

## Features

- Live session list with connection status
- Tool call timeline with duration and result
- Error log with stack traces
- Screenshot grid from recent captures
- Human-in-the-loop command interface (pause/resume agent actions)

## License

Apache-2.0 - see [LICENSE](LICENSE).
