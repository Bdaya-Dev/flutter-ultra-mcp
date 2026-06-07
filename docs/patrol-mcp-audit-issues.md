# patrol_mcp Audit — GitHub Issues to File

> Target repo: `Bdaya-Dev/flutter-ultra-mcp`
> Audit date: 2026-06-08
> Source: `D:\packages\patrol\packages\patrol_mcp` (patrol_plus v0.2.0)

---

## Issue #1: feat(patrol): add get_patrol_native_tree tool via test server /getNativeViews

**Labels:** enhancement

### Summary

Add a `get_patrol_native_tree` tool to `flutter-ultra-patrol` that fetches the platform-native UI hierarchy via Patrol's test server `/getNativeViews` HTTP endpoint during active develop sessions.

### Motivation

patrol_mcp's `native-tree` tool calls the patrol test server's `/getNativeViews` endpoint, returning the **platform-native view hierarchy** (Android `ViewHierarchy` / iOS `XCUIElement` tree) through Patrol's instrumentation.

flutter-ultra currently has:
- `dump_a11y_tree` (native-mobile) — uses uiautomator dump / WDA source, independent of patrol
- `dump_semantics_tree` / `get_widget_tree` (runtime) — Flutter-level, not native-level

Neither talks to the patrol test server. The patrol test server tree is:
- **Synced with test state** — reflects what Patrol sees right now
- **Cross-app capable** — includes system UI and other apps' views
- **Usable during `patrol develop`** — complements the interactive session

### Implementation Reference

From `patrol_mcp` `native_tree_service.dart`:

```dart
final uri = Uri.http('localhost:$port', '/getNativeViews');
final request = await client.postUrl(uri)
  ..headers.contentType = ContentType.json
  ..write(jsonEncode({'selector': null, 'iosInstalledApps': iosApps, 'appId': ''}));
```

Key design decisions:
1. Test server port from develop session (default 8081)
2. Android needs ADB port forwarding before HTTP call
3. iOS traffic goes directly to localhost
4. Tree trimming — strip non-selector fields, flatten empty "other" wrapper nodes

### Acceptance Criteria

- [ ] Tool registered in `flutter-ultra-patrol` package
- [ ] HTTP POST to `localhost:<port>/getNativeViews` with correct payload
- [ ] ADB port forwarding for Android devices
- [ ] Tree trimming when `compact: true`
- [ ] Flatten empty "other" nodes (hoist children)
- [ ] Returns structured JSON tree
- [ ] Error handling for: no active session, test server not ready, empty tree

---

## Issue #2: feat(runtime,native-mobile): add compact tree trimming option to reduce token usage

**Labels:** enhancement

### Summary

Add an optional `compact: boolean` parameter to tree-dump tools (`dump_a11y_tree`, `get_widget_tree`, `dump_semantics_tree`, `dump_render_tree`, `dump_layer_tree`) that strips non-essential fields and flattens empty wrapper nodes.

### patrol_mcp's Trimming Strategy

```dart
static const _keepFields = {
  'identifier', 'label', 'title', 'value', 'placeholderValue',
  'resourceName', 'text', 'contentDescription', 'className',
  'elementType', 'children',
};

// Flatten "other" nodes without identifying info
if (elementType == 'other' && !hasIdentity) {
  return children.isNotEmpty ? _flattenRoots(children) : [];
}
```

### Affected Tools

| Package | Tool | Keep-fields for compact mode |
|---|---|---|
| `flutter-ultra-native-mobile` | `dump_a11y_tree` | `resource-id`, `text`, `content-desc`, `class`, `bounds`, `clickable`, `focusable`, `children` |
| `flutter-ultra-runtime` | `get_widget_tree` | `description`, `type`, `hasChildren`, `children`, `valueId`, `createdByLocalProject` |
| `flutter-ultra-runtime` | `dump_semantics_tree` | Text output — line-level filtering |
| `flutter-ultra-runtime` | `dump_render_tree` | Text output — line-level filtering |
| `flutter-ultra-runtime` | `dump_layer_tree` | Text output — line-level filtering |

### Acceptance Criteria

- [ ] `compact` parameter added to all 5 tree-dump tools
- [ ] Default `true` (AI agents are primary consumers)
- [ ] Structured trees: strip non-keep fields, flatten empty wrappers
- [ ] Text trees: filter to relevant lines
- [ ] Null/empty values stripped
- [ ] No data loss when `compact: false`

---

## Issue #3: feat(patrol): add returnBase64 option to stop_patrol_recording

**Labels:** enhancement

### Summary

Add `returnBase64` option to `stop_patrol_recording` that reads the output file and returns content as base64 inline, eliminating a round-trip file read. Consistent with `take_patrol_screenshot`'s existing `returnBase64`.

### Acceptance Criteria

- [ ] `returnBase64: boolean` parameter added to `stop_patrol_recording`
- [ ] When true, poll for output file (up to 10s), read and return base64
- [ ] Correct MIME type based on format (gif vs webm)
- [ ] Graceful fallback if file not yet written
- [ ] Consistent with `take_patrol_screenshot`'s pattern

---

## Issue #4: feat(patrol): auto-connect CDP console capture on web develop session start

**Labels:** enhancement

### Summary

When `start_patrol_develop` creates a web-targeted session, automatically begin passive CDP console capture so browser errors are always available via `get_patrol_browser_errors` without explicit setup.

### Implementation Reference

patrol_mcp's `_tryConnectCdp()`: 10 retries at 3s intervals, background, abort if session ends.

### Acceptance Criteria

- [ ] Web develop sessions auto-start CDP console capture with retry loop
- [ ] Errors available via `get_patrol_browser_errors` without explicit setup
- [ ] Retry logic: up to 10 attempts, 3s interval, abort if session ends
- [ ] Opt-out via `autoCdpCapture: false` on `start_patrol_develop`
- [ ] Does not block session start (runs in background)

---

## Issue #5: feat(patrol): add unified patrol_session_status tool

**Labels:** enhancement

### Summary

Add `patrol_session_status` tool returning test state + device info + browser errors + output in one call (patrol_mcp's `status` pattern). Currently requires 3 separate calls.

### Response Schema

```typescript
{
  isDevelopRunning: boolean;
  testState: 'idle' | 'running' | 'passed' | 'failed';
  currentTestFile: string | null;
  devicePlatform: string | null;
  webDebuggerPort: number | null;
  recentOutput: string[];
  browserErrors: { ts: number; message: string }[];
  browserLogs: { ts: number; message: string }[];
  summary: string;
}
```

### Acceptance Criteria

- [ ] Tool registered as `patrol_session_status`
- [ ] Aggregates: develop session state + job state + browser errors + output tail
- [ ] Returns `{ isDevelopRunning: false }` when no session (not an error)
- [ ] Read-only, idempotent
- [ ] `recentOutput` capped at last 200 lines

---

## Issue #6: feat(patrol): smart hot-restart when re-running same test file

**Labels:** enhancement

### Summary

When `patrol_develop_run` is called with the same test file already running, auto hot-restart instead of failing.

### Behavior

| Scenario | Current | Proposed |
|---|---|---|
| No active session | Start new | Start new (unchanged) |
| Same test file | Error | Hot restart + clear buffer |
| Different test file | Error | Error suggesting `cancel_patrol_job` |

### Acceptance Criteria

- [ ] `patrol_develop_run` checks for active develop session
- [ ] Same file → hot restart dispatched, output buffer cleared
- [ ] Different file → clear error suggesting `cancel_patrol_job` first
- [ ] Response indicates fresh start vs hot restart
