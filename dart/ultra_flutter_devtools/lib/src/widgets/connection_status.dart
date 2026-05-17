import 'package:flutter/material.dart';

import '../services/ws_connection.dart';

/// Status bar showing connection state to the MCP devtools server.
class ConnectionStatus extends StatelessWidget {
  const ConnectionStatus({required this.connection, super.key});

  final WsConnection connection;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final connected = connection.connected;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      color: theme.colorScheme.surfaceContainerHighest,
      child: Row(
        children: [
          Icon(
            Icons.circle,
            size: 10,
            color: connected ? Colors.green : Colors.red,
          ),
          const SizedBox(width: 8),
          Text(
            connected
                ? 'Connected to flutter-ultra-devtools @ ${connection.defaultUrl}'
                : 'Disconnected',
            style: theme.textTheme.bodySmall,
          ),
          const Spacer(),
          if (connection.viewerId != null)
            Text(
              'Viewer: ${connection.viewerId!.substring(0, 8)}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }
}
