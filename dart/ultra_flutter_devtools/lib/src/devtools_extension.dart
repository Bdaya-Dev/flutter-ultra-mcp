import 'package:devtools_extensions/devtools_extensions.dart';
import 'package:flutter/material.dart';

import 'services/ws_connection.dart';
import 'widgets/connection_status.dart';
import 'widgets/event_timeline.dart';
import 'widgets/panel_controls.dart';
import 'widgets/session_list.dart';

/// Root widget for the ultra_flutter DevTools extension panel.
class UltraFlutterDevToolsExtension extends StatefulWidget {
  const UltraFlutterDevToolsExtension({super.key});

  @override
  State<UltraFlutterDevToolsExtension> createState() =>
      _UltraFlutterDevToolsExtensionState();
}

class _UltraFlutterDevToolsExtensionState
    extends State<UltraFlutterDevToolsExtension> {
  final WsConnection _connection = WsConnection();

  @override
  void initState() {
    super.initState();
    _connection.connect();
  }

  @override
  void dispose() {
    _connection.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DevToolsExtension(
      child: ListenableBuilder(
        listenable: _connection,
        builder: (context, _) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ConnectionStatus(connection: _connection),
              const Divider(height: 1),
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 220,
                      child: SessionList(connection: _connection),
                    ),
                    const VerticalDivider(width: 1),
                    Expanded(
                      child: EventTimeline(connection: _connection),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              PanelControls(connection: _connection),
            ],
          );
        },
      ),
    );
  }
}
