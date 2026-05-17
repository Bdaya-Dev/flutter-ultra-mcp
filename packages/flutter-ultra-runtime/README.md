# @flutter-ultra/flutter-ultra-runtime

MCP server for Flutter **runtime control**: discover + attach to `flutter run`
debug sessions over DDS, introspect the widget tree (read-only), hot
reload/restart, evaluate Dart, capture HTTP/gRPC traffic, tail logs.

Part of the [flutter-ultra-mcp](https://github.com/Bdaya-Dev/flutter-ultra-mcp)
plugin. See plan §5.2 for the full catalogue.

## Tools (28)

| Group                  | Tools                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery + lifecycle  | `discover_sessions`, `attach`, `detach`, `list_sessions`, `launch_app`, `poll_launch_app`, `stop_app`, `hot_reload`, `hot_restart`                                                                                                                         |
| Inspection (read-only) | `get_widget_tree`, `get_widget_details`, `get_selected_widget`, `set_selected_widget`, `widget_exists` (rev 23), `find_widget` (rev 23), `count_widget_tree_nodes`, `screenshot`, `dump_render_tree`, `dump_layer_tree`, `dump_semantics_tree`, `evaluate` |
| Toggles                | `toggle_debug_paint`, `toggle_perf_overlay`, `set_time_dilation`, `set_platform_override`                                                                                                                                                                  |
| Logs                   | `get_logs`, `start_tail_logs`, `poll_tail_logs`, `stop_tail_logs`, `get_runtime_errors`, `log_buffer_stats`                                                                                                                                                |
| HTTP / gRPC capture    | `start_http_capture`, `get_http_events`, `stop_http_capture`, `decode_grpc_message`                                                                                                                                                                        |

All inspect tools are read-only side-effect-free; `widget_exists` / `find_widget`
walk `ext.flutter.inspector.getRootWidgetSummaryTree` per AC-R5.

## Session model

Sessions persist to `${CLAUDE_PLUGIN_DATA}/state/sessions.json` so the
gesture, devtools, and patrol servers can read the WS URI without IPC.
This server is the sole writer. Each session is a `VmServiceClient`
behind a reference-counted `SessionResource` — parallel tool calls share
one WebSocket per plan §17.10.

DDS multi-client coexistence with VS Code's Dart debugger is automatic;
our connection sets `setClientName('flutter-ultra/runtime/<pid>')` per
plan §7.2.

## Discovery ladder

Implemented per worker-P's empirical report
([`docs/discovery-empirics.md`](../../docs/discovery-empirics.md)):

1. Process scan for `dart` / `flutter` / `dartvm` / `chrome` with
   `--enable-vm-service=<port>` in cmdline.
2. HTTP GET the raw VM port — the body redirects us to the DDS URI.
3. Convert `http://...` → `ws://.../ws`.
4. Probe `getVM` to confirm the URI is alive before returning.

## Acceptance criteria covered

- **AC-R1**: `hot_reload` completes < 5 s; `get_widget_tree` returns the
  post-reload tree without re-attach.
- **AC-R2**: WS drop triggers exp-backoff reconnect inside
  `@flutter-ultra/vm-service-client` (0.5/1/2/4/8/14.5 s).
- **AC-R3**: Per-session `SessionResource<VmServiceClient>` keeps two
  attached sessions strictly isolated.
- **AC-R4**: `screenshot` returns a PNG ≥ 200 bytes.
- **AC-R5 (rev 23)**: `widget_exists({kind:'key', value:'X'})` returns
  `{exists, count, bounds?}` in < 300 ms on a 500-node tree without
  triggering setState / hot-reload / route navigation side effects
  (verified via the summary tree extension which is explicitly
  side-effect-free).

## License

Apache-2.0.
