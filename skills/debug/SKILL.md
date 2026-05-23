---
name: flutter-debug
description: Attaches to a running Flutter app and triages an error from the stack trace, widget tree, render tree, network traffic, and screenshots. Use when the user reports a runtime exception, layout overflow, blank screen, unexpected behaviour, performance jank, or network failure and you need to inspect live state.
---

# Attach, Inspect, and Triage

Collect live evidence before diagnosing. Propose code fixes only after inspecting live state.

## Workflow

### 1. Attach to the session

- `mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions` to find active sessions.
- `mcp__plugin_flutter_flutter-ultra-runtime__attach` with the matching session.

### 2. Capture initial state (run together)

- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — visual snapshot.
- `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` — unhandled exceptions.
- `mcp__plugin_flutter_flutter-ultra-runtime__get_logs` — recent framework/app log output.
- `mcp__plugin_flutter_flutter-ultra-runtime__log_buffer_stats` — check if logs were truncated.

### 3. Triage by error type

#### 3a. Runtime exception (stack trace present)

1. Read the stack trace from `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors`.
2. `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to inspect the problematic object:
   ```dart
   MyWidget.of(context)?.someField?.toString() ?? 'NULL'
   ```
3. `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` around the error location.
4. `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_details` on a specific widget for full properties.

#### 3b. Layout overflow (RenderFlex / RenderBox)

1. `mcp__plugin_flutter_flutter-ultra-runtime__dump_render_tree` — search for `OVERFLOWED`.
2. `mcp__plugin_flutter_flutter-ultra-runtime__toggle_debug_paint` to enable visual overlays.
3. `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — capture the debug paint view.
4. Trace the overflowing render object back to its widget via `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree`.

#### 3c. Blank screen / wrong route

1. `mcp__plugin_flutter_flutter-ultra-runtime__evaluate`:
   ```dart
   GoRouter.of(context).routerDelegate.currentConfiguration.fullPath
   ```
2. `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` — look for `ErrorWidget` or empty `SizedBox`.
3. `mcp__plugin_flutter_flutter-ultra-runtime__get_logs` for redirect events.

#### 3d. State / data issue

1. `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to read BLoC/Riverpod/Provider state.
2. `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` to verify rebuild propagation.
3. `mcp__plugin_flutter_flutter-ultra-runtime__find_widget` to locate specific widgets showing wrong data.

#### 3e. Network / API failure

1. `mcp__plugin_flutter_flutter-ultra-runtime__start_http_capture` to begin recording.
2. Reproduce the action that triggers the API call.
3. `mcp__plugin_flutter_flutter-ultra-runtime__get_http_events` to inspect requests/responses.
4. `mcp__plugin_flutter_flutter-ultra-runtime__decode_grpc_message` for gRPC payloads.
5. `mcp__plugin_flutter_flutter-ultra-runtime__stop_http_capture` when done.
6. For web targets, also check `mcp__plugin_flutter_flutter-ultra-browser__console_logs` and `mcp__plugin_flutter_flutter-ultra-browser__network_requests` for CORS or fetch errors.

#### 3f. Performance jank

1. `mcp__plugin_flutter_flutter-ultra-runtime__toggle_perf_overlay` to enable the performance overlay.
2. `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` to capture the overlay.
3. `mcp__plugin_flutter_flutter-ultra-runtime__start_frame_tracking` to begin frame timing capture.
4. Reproduce the janky interaction.
5. `mcp__plugin_flutter_flutter-ultra-runtime__get_frame_timing` to read build/raster times.
6. `mcp__plugin_flutter_flutter-ultra-runtime__stop_frame_tracking`.
7. `mcp__plugin_flutter_flutter-ultra-runtime__start_rebuild_tracking` to find excessive rebuilds.
8. `mcp__plugin_flutter_flutter-ultra-runtime__get_rebuild_stats` to identify hot widgets.
9. `mcp__plugin_flutter_flutter-ultra-runtime__stop_rebuild_tracking`.
10. `mcp__plugin_flutter_flutter-ultra-runtime__get_memory_usage` and `mcp__plugin_flutter_flutter-ultra-runtime__get_allocation_profile` for memory pressure issues.

#### 3g. Accessibility / semantics issue

1. `mcp__plugin_flutter_flutter-ultra-runtime__dump_semantics_tree` — check for missing labels or roles.
2. For mobile, `mcp__plugin_flutter_flutter-ultra-native-mobile__dump_a11y_tree` for the OS-level accessibility tree.

#### 3h. Mobile-specific issues

1. `mcp__plugin_flutter_flutter-ultra-native-mobile__start_device_logs` to capture platform-level logs.
2. `mcp__plugin_flutter_flutter-ultra-native-mobile__poll_device_logs` to read logcat/syslog.
3. `mcp__plugin_flutter_flutter-ultra-native-mobile__stop_device_logs` when done.

### 4. Deeper inspection

- `mcp__plugin_flutter_flutter-ultra-runtime__dump_render_tree` — sizes, constraints, positions.
- `mcp__plugin_flutter_flutter-ultra-runtime__dump_layer_tree` — compositing, repaint boundaries.
- `mcp__plugin_flutter_flutter-ultra-runtime__find_widget` to locate a specific widget by key or text.
- `mcp__plugin_flutter_flutter-ultra-runtime__count_widget_tree_nodes` to gauge tree complexity.
- `mcp__plugin_flutter_flutter-ultra-runtime__start_tail_logs` + `mcp__plugin_flutter_flutter-ultra-runtime__poll_tail_logs` for live log streaming during reproduction.

### 5. Advanced VM service access

For low-level inspection beyond the standard helpers, use `mcp__plugin_flutter_flutter-ultra-runtime__call_vm_service_method` to call raw VM Service protocol methods directly:

- `getStack` — full isolate stack frames at any moment (useful when `get_runtime_errors` doesn't capture a synchronous deadlock).
- `getObject` — inspect any live Dart object by its VM object ID retrieved from `evaluate`.
- `evaluate` with full params — pass `disableBreakpoints: true` or `scope` overrides that the wrapper `evaluate` tool does not expose.

```
call_vm_service_method(
  method: "getStack",
  params: { "isolateId": "<id>", "limit": 20 }
)
```

Use this when `evaluate` and `get_runtime_errors` are insufficient to explain observed behaviour.

### 6. Evaluate in-app expressions

`mcp__plugin_flutter_flutter-ultra-runtime__evaluate` freely to inspect live objects:

- `myCompleter.isCompleted`
- `context.read<MyBloc>().state.toString()`
- `ProviderScope.containerOf(context).read(myProvider).toString()`

### 7. Static analysis and auto-fix

When the runtime triage points to a code-level issue:

- `mcp__plugin_flutter_flutter-ultra-build__analyze` — run static analysis to surface type errors, lint violations, and deprecation warnings related to the bug.
- `mcp__plugin_flutter_flutter-ultra-build__fix_preview` — preview automated fixes before applying.
- `mcp__plugin_flutter_flutter-ultra-build__fix` — apply safe automated fixes (`dart fix --apply`).

### 8. IDE-level code navigation

Use LSP tools for pinpoint navigation when reading unfamiliar call paths:

- `mcp__plugin_oh-my-claudecode_t__lsp_hover` (`dart_hover`) — inspect the type, docs, and inferred value of any expression at a given file:line:col without running the app.
- `mcp__plugin_oh-my-claudecode_t__lsp_goto_definition` (`dart_go_to_definition`) — jump to the declaration of the method or class under the cursor.
- `mcp__plugin_oh-my-claudecode_t__lsp_document_symbols` (`get_active_location`) — list all symbols in the current file to map the class/method structure quickly.

### 9. Test the fix

1. Apply the code change.
2. `mcp__plugin_flutter_flutter-ultra-runtime__hot_reload` (or `mcp__plugin_flutter_flutter-ultra-runtime__hot_restart` if `initState` changed).
3. Re-run the appropriate triage step to confirm the error is gone.
4. `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` for before/after comparison.

## Build and LSP tool reference

| Action                    | Tool                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| Static analysis           | `mcp__plugin_flutter_flutter-ultra-build__analyze`                |
| Preview auto-fixes        | `mcp__plugin_flutter_flutter-ultra-build__fix_preview`            |
| Apply auto-fixes          | `mcp__plugin_flutter_flutter-ultra-build__fix`                    |
| Hover type/docs           | `mcp__plugin_oh-my-claudecode_t__lsp_hover`                       |
| Go to definition          | `mcp__plugin_oh-my-claudecode_t__lsp_goto_definition`             |
| List file symbols         | `mcp__plugin_oh-my-claudecode_t__lsp_document_symbols`            |

## Common patterns

| Symptom                                  | First tool                                    | What to look for                         |
| ---------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| `Null check operator used on null value` | `get_runtime_errors` + `evaluate`             | Null state before async load completes   |
| `RenderFlex overflowed by N pixels`      | `dump_render_tree` + `toggle_debug_paint`     | Missing `Expanded`/`Flexible`            |
| Blank white screen                       | `get_widget_tree` + `evaluate` (route)        | `ErrorWidget` at root; redirect loop     |
| `setState called after dispose`          | `get_runtime_errors` + `get_logs`             | Async callback with stale `BuildContext` |
| Navigation not working                   | `evaluate` (GoRouter path) + `get_logs`       | Route guard redirecting                  |
| Infinite loading spinner                 | `evaluate` (state) + `get_logs`               | Future never completing                  |
| Wrong data displayed                     | `evaluate` (BLoC/provider state)              | Stale state; `watch` vs `read` misuse    |
| API returning errors                     | `start_http_capture` + `get_http_events`      | 401/403/500 responses; CORS blocks       |
| UI jank during scrolling                 | `start_frame_tracking` + `get_frame_timing`   | Frames exceeding 16ms budget             |
| Memory growing unbounded                 | `get_memory_usage` + `get_allocation_profile` | Leaked listeners or controllers          |

## Output format

1. **Root cause**: one sentence identifying the exact problem.
2. **Evidence**: which tool output revealed it.
3. **Proposed fix**: specific code change with file:line reference (do not edit unless asked).
4. **Screenshots**: before/after paths.

## Example

```
User: "The invoices list shows a blank white screen after merging the filter PR."

1. discover_sessions -> attach(sessionId: "flutter-1")
2. screenshot -> blank screen confirmed
3. get_runtime_errors -> "Null check operator on null value at invoice_list_bloc.dart:47"
4. evaluate: context.read<InvoiceListBloc>().state -> "InvoiceListInitial"
5. get_widget_tree -> root is ErrorWidget wrapping the list scaffold
6. start_http_capture -> get_http_events -> GET /api/invoices returned 200 with empty filter
7. Root cause: line 47 calls `event.filter!` but filter is null on first load
8. Proposed fix: `event.filter ?? const InvoiceFilter()` at line 47
9. hot_reload -> screenshot -> list loads correctly
```

## See also

- `flutter-drive` — drive interactive flows to reproduce the bug
- `flutter-test` — run the test suite after applying a fix
