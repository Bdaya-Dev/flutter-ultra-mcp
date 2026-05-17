# @flutter-ultra/flutter-ultra-runtime

MCP server for **Flutter runtime** control: discover + attach to `flutter run` debug sessions over DDS, introspect VM Service, hot reload / restart, evaluate Dart expressions.

**Status:** scaffold stub. Implementation owner: **wave-2 runtime worker** (see plan §12).

This server owns the session discovery + state file (`state/sessions.json`) per plan §4 IPC.
