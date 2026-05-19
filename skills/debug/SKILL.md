---
name: flutter-debug
description: Attaching to a running Flutter app and triaging an error from the stack trace, widget tree, render tree, and recent screenshot. Use when the user reports a runtime exception, layout overflow, or unexpected behaviour and you need to inspect live state.
---

# flutter-debug — Attach, Inspect, and Triage

## When to use

Use this skill when the user reports a runtime exception, a layout overflow, a blank screen, unexpected navigation, or any "it's broken" situation in a running Flutter app. The goal is to collect enough live evidence to diagnose the root cause without guessing. Propose code fixes only after inspecting live state — never before.

## Prerequisites

- A Flutter app is running in debug mode (VM Service available).
- The user has described the symptom: exception message, screen name, reproduction steps, or "just broke".
- Do **not** modify any source files during this skill unless the user explicitly asks for a fix.

## Workflow

Follow the triage ladder in order — stop at the level where the root cause becomes clear.

### 1. Attach to the session

- Call `mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions` — list all active sessions.
- Pick the session matching the reported app (by name or port).
- Call `mcp__plugin_flutter_flutter-ultra-runtime__attach` with `sessionId`.

### 2. Capture initial state

Run these together immediately after attach:

- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — visual snapshot of the current screen.
- `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` — all unhandled exceptions since last clear.
- `mcp__plugin_flutter_flutter-ultra-runtime__get_logs` — recent `debugPrint` / `print` / framework log output.

### 3. Triage by error type

#### 3a. Runtime exception (stack trace present)

1. Read the stack trace from `get_runtime_errors` — identify the throwing file and line.
2. Call `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to inspect the problematic object:
   ```dart
   // Example: check if a value is null
   MyWidget.of(context)?.someField?.toString() ?? 'NULL'
   ```
3. Call `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` focused on the widget subtree around the reported location — pass `widgetId` if known from the stack frame.
4. Look for: null state, missing providers, incorrect key types, uninitialized controllers.

#### 3b. Layout overflow (RenderFlex / RenderBox overflow)

1. Call `mcp__plugin_flutter_flutter-ultra-runtime__dump_render_tree` — search the output for `OVERFLOWED` or constraint violations.
2. Call `mcp__plugin_flutter_flutter-ultra-runtime__toggle_debug_paint` to enable visual constraint overlays; take another `screenshot`.
3. Identify the overflowing `RenderFlex` or `RenderConstrainedBox` and trace it back to the widget via `get_widget_tree`.
4. Common causes: missing `Expanded`/`Flexible`, fixed height in a `Column` inside a scrollable, `Text` without `overflow: TextOverflow.ellipsis`.

#### 3c. Blank screen / wrong route

1. Call `mcp__plugin_flutter_flutter-ultra-runtime__evaluate`:
   ```dart
   GoRouter.of(context).routerDelegate.currentConfiguration.fullPath
   ```
   to confirm the actual current route.
2. Call `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` from root — look for `ErrorWidget`, empty `SizedBox`, or a redirect loop (same route repeated in the navigator stack).
3. Check `get_logs` for GoRouter redirect events or `debugPrint` from route guards.

#### 3d. State / data issue (wrong data shown, stale UI)

1. Call `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to read the current BLoC/Riverpod/Provider state:
   ```dart
   context.read<MyBloc>().state.toString()
   // or for Riverpod:
   ProviderScope.containerOf(context).read(myProvider).toString()
   ```
2. Compare against expected values from the user's description.
3. Call `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` to verify the widget rebuilds are reaching the right subtree.

#### 3e. Accessibility / semantics issue

1. Call `mcp__plugin_flutter_flutter-ultra-runtime__dump_semantics_tree` — look for missing labels, incorrect roles, or hidden interactive elements.
2. Check for `excludeFromSemantics: true` incorrectly applied to interactive widgets.

### 4. Inspect the widget tree around the problem

- Call `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` with the suspected parent widget key or type as anchor.
- Call `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_details` on a specific widget ID to get its full properties (constraints, size, key, state).
- Call `mcp__plugin_flutter_flutter-ultra-runtime__find_widget` to locate a specific widget by key or text when the tree is large.

### 5. Deeper render inspection

If layout is the issue and the widget tree alone is not enough:
- Call `mcp__plugin_flutter_flutter-ultra-runtime__dump_render_tree` — this shows sizes, constraints, and positions for every render object.
- Call `mcp__plugin_flutter_flutter-ultra-runtime__dump_layer_tree` for compositing and repaint boundary issues (useful for performance jank or incorrect clipping).

### 6. Evaluate in-app expressions

Use `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` freely to inspect live objects:
- Check if a future completed: `myCompleter.isCompleted`
- Read a stream's last value: `myStreamController.stream` (wrap in a Future)
- Confirm a service is initialized: `MyService.instance != null`

### 7. Test the fix

Once the root cause is identified and a code fix is proposed (or applied at user request):
- Call `mcp__plugin_flutter_flutter-ultra-runtime__hot_reload` to apply changes without losing app state.
- Repeat step 3 (appropriate branch) to confirm the error is gone.
- Call `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` for a before/after comparison.
- If hot reload is not sufficient (e.g. `initState` changed), call `mcp__plugin_flutter_flutter-ultra-runtime__hot_restart`.

## Common patterns and their diagnosis

| Symptom | First tool | What to look for |
|---------|-----------|------------------|
| `Null check operator used on a null value` | `get_runtime_errors` + `evaluate` | Null state before async load completes; missing null guard |
| `RenderFlex overflowed by N pixels` | `dump_render_tree` + `toggle_debug_paint` | Column/Row child without `Expanded`; fixed height container |
| Blank white screen | `get_widget_tree` + `evaluate` (route) | `ErrorWidget` at root; redirect loop; unhandled exception in build |
| `setState called after dispose` | `get_runtime_errors` + `get_logs` | Async callback holding stale `BuildContext`; missing `mounted` check |
| Navigation not working | `evaluate` (GoRouter path) + `get_logs` | Route guard redirecting; wrong named route; deep link not registered |
| Infinite loading spinner | `evaluate` (state) + `get_logs` | Future never completing; stream not emitting; provider not notifying |
| Wrong data displayed | `evaluate` (BLoC/provider state) | Stale state; `context.watch` vs `context.read` misuse |

## Output format

After triage, produce:
1. **Root cause**: one sentence identifying the exact problem.
2. **Evidence**: which tool output revealed it (stack trace line, widget tree excerpt, render tree constraint).
3. **Proposed fix**: specific code change with file and line reference (do not edit unless asked).
4. **Screenshots**: before state screenshot path; after-fix screenshot path if hot_reload was applied.

## Example

```
User: "The invoices list is showing a blank white screen after I merged the new filter PR."

1. discover_sessions → attach(sessionId: "flutter-1")
2. screenshot → blank screen confirmed
3. get_runtime_errors → "Null check operator used on null value at invoice_list_bloc.dart:47"
4. evaluate: context.read<InvoiceListBloc>().state.toString() → "InvoiceListInitial"
   (bloc never emitted data — the filter query returned null instead of empty list)
5. get_widget_tree → root is ErrorWidget wrapping the list scaffold
6. Root cause: InvoiceListBloc.mapEventToState at line 47 calls `event.filter!` but
   filter is null on first load after the PR introduced a nullable field.
7. Proposed fix: change `event.filter!` to `event.filter ?? const InvoiceFilter()` at
   invoice_list_bloc.dart:47.
8. hot_reload → screenshot → list loads correctly.
```

## See also

- Sibling skill: `flutter-drive` for driving interactive flows before/after a fix
- `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` — unhandled exception log
- `mcp__plugin_flutter_flutter-ultra-runtime__dump_render_tree` — full render object tree with constraints
- `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` — arbitrary Dart expression in live app context
