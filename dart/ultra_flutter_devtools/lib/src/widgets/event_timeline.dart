import 'package:flutter/material.dart';

import '../models/panel_event.dart';
import '../services/ws_connection.dart';

/// Scrollable timeline showing recent tool calls from all MCP servers.
class EventTimeline extends StatelessWidget {
  const EventTimeline({required this.connection, super.key});

  final WsConnection connection;

  @override
  Widget build(BuildContext context) {
    final events = connection.events;
    final theme = Theme.of(context);

    if (events.isEmpty) {
      return Center(
        child: Text(
          connection.connected
              ? 'Waiting for tool calls...'
              : 'Connect to see events',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            children: [
              Text(
                'Recent Tool Calls (${events.length})',
                style: theme.textTheme.titleSmall,
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.clear_all, size: 18),
                onPressed: connection.clearEvents,
                tooltip: 'Clear',
                iconSize: 18,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(
                  minWidth: 28,
                  minHeight: 28,
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            reverse: true,
            itemCount: events.length,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            itemBuilder: (context, index) {
              final event = events[events.length - 1 - index];
              return _EventTile(event: event);
            },
          ),
        ),
      ],
    );
  }
}

class _EventTile extends StatelessWidget {
  const _EventTile({required this.event});

  final PanelEvent event;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final time = '${event.timestamp.hour.toString().padLeft(2, '0')}:'
        '${event.timestamp.minute.toString().padLeft(2, '0')}:'
        '${event.timestamp.second.toString().padLeft(2, '0')}';

    final color = switch (event.type) {
      'error' => Colors.red,
      'tool_result' => Colors.blue,
      'session_change' => Colors.orange,
      'log' => Colors.grey,
      _ => theme.colorScheme.primary,
    };

    final status = event.payload?['success'] == true
        ? 'OK'
        : event.isError
            ? 'FAIL'
            : '';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 64,
            child: Text(
              time,
              style: theme.textTheme.bodySmall?.copyWith(
                fontFamily: 'monospace',
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(width: 4),
          Icon(Icons.circle, size: 6, color: color),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              '${event.server ?? ''}${event.tool != null ? '.${event.tool}' : ''}',
              style: theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (status.isNotEmpty)
            Text(
              status,
              style: theme.textTheme.bodySmall?.copyWith(
                color: event.isError ? Colors.red : Colors.green,
                fontWeight: FontWeight.bold,
              ),
            ),
        ],
      ),
    );
  }
}
