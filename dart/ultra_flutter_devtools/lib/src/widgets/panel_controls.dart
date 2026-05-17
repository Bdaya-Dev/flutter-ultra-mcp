import 'package:flutter/material.dart';

import '../services/ws_connection.dart';

/// Bottom control bar: Pause Agent, Resume, Inject Manual Tool Call.
class PanelControls extends StatelessWidget {
  const PanelControls({required this.connection, super.key});

  final WsConnection connection;

  @override
  Widget build(BuildContext context) {
    final connected = connection.connected;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          FilledButton.tonalIcon(
            onPressed: connected ? () => connection.sendCommand('pause') : null,
            icon: const Icon(Icons.pause, size: 16),
            label: const Text('Pause Agent'),
          ),
          const SizedBox(width: 8),
          FilledButton.tonalIcon(
            onPressed: connected ? () => connection.sendCommand('resume') : null,
            icon: const Icon(Icons.play_arrow, size: 16),
            label: const Text('Resume'),
          ),
          const Spacer(),
          OutlinedButton.icon(
            onPressed: connected ? () => _showInjectDialog(context) : null,
            icon: const Icon(Icons.terminal, size: 16),
            label: const Text('Inject Command'),
          ),
        ],
      ),
    );
  }

  void _showInjectDialog(BuildContext context) {
    final controller = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Inject Manual Command'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: 'Command name (e.g., screenshot, inspect)',
            border: OutlineInputBorder(),
          ),
          autofocus: true,
          onSubmitted: (value) {
            if (value.isNotEmpty) {
              connection.sendCommand(value);
              Navigator.of(ctx).pop();
            }
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final value = controller.text;
              if (value.isNotEmpty) {
                connection.sendCommand(value);
                Navigator.of(ctx).pop();
              }
            },
            child: const Text('Send'),
          ),
        ],
      ),
    );
  }
}
