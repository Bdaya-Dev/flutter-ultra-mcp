import 'package:flutter/material.dart';

import '../models/panel_event.dart';
import '../services/ws_connection.dart';

/// Shows active sessions derived from session_change events.
class SessionList extends StatelessWidget {
  const SessionList({required this.connection, super.key});

  final WsConnection connection;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sessions = _extractSessions(connection.events);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(8),
          child: Text('Sessions', style: theme.textTheme.titleSmall),
        ),
        Expanded(
          child: sessions.isEmpty
              ? Center(
                  child: Text(
                    'No sessions',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                )
              : ListView.builder(
                  itemCount: sessions.length,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  itemBuilder: (context, index) {
                    final session = sessions[index];
                    return _SessionTile(session: session);
                  },
                ),
        ),
      ],
    );
  }

  List<_SessionInfo> _extractSessions(List<PanelEvent> events) {
    final map = <String, _SessionInfo>{};
    for (final event in events) {
      if (event.type != 'session_change') continue;
      final id = event.payload?['sessionId'] as String?;
      if (id == null) continue;
      map[id] = _SessionInfo(
        id: id,
        device: event.payload?['device'] as String? ?? 'unknown',
        status: event.payload?['status'] as String? ?? 'active',
      );
    }
    return map.values.toList();
  }
}

class _SessionInfo {
  _SessionInfo({required this.id, required this.device, required this.status});

  final String id;
  final String device;
  final String status;
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({required this.session});

  final _SessionInfo session;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isActive = session.status == 'active';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(
            Icons.circle,
            size: 8,
            color: isActive ? Colors.green : Colors.grey,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  session.id.length > 8
                      ? session.id.substring(0, 8)
                      : session.id,
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  session.device,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
