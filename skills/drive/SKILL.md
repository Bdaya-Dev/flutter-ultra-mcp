---
name: flutter-drive
description: Driving multi-step user flows in a running Flutter app via gestures and assertions. Use when reproducing a bug across several screens, validating an onboarding flow, or running an ad-hoc end-to-end scenario without writing a patrol test.
---

# flutter-drive — Multi-Step User Flow Automation

## When to use

Use this skill when the user wants to walk through a specific interactive flow — login sequences, checkout funnels, onboarding wizards, form submissions — and wants the agent to drive the app step by step, verifying state and capturing screenshots between major steps. This is ad-hoc flow automation; for repeatable E2E test suites use the `flutter-test` skill instead.

## Prerequisites

- A Flutter app is running in debug mode with the `ultra_flutter` binding initialized (or the app can be launched via `mcp__plugin_flutter_flutter-ultra-runtime__launch_app`).
- The user has described the flow to execute (e.g. "log in as user@example.com, navigate to invoices, open the first one").
- For web OAuth flows: a browser context must be available via `mcp__plugin_flutter_flutter-ultra-browser__launch_browser`.

## Workflow

### 1. Attach to the running session

- Call `mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions` — pick the session matching the target app.
- Call `mcp__plugin_flutter_flutter-ultra-runtime__attach` with `sessionId`.
- Take an initial screenshot with `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` to confirm starting state.

### 2. Plan the flow steps

Break the user's request into discrete, verifiable steps:
```
Step 1: Navigate to /login
Step 2: Enter email "user@example.com" in field key='email-field'
Step 3: Enter password in field key='password-field'
Step 4: Tap button key='sign-in-button'
Step 5: Verify dashboard loaded (widget key='dashboard-root' present)
Step 6: Screenshot
```
Announce the plan before executing if it involves more than 3 steps.

### 3. For each step — inspect → act → verify → screenshot

**Inspect the current UI:**
- Call `mcp__plugin_flutter_flutter-ultra-runtime__find_widget` with `key` or `text` to confirm the target element exists before acting.
- If `find_widget` returns nothing, call `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` to understand the current widget hierarchy and adjust the finder.

**Perform the action** (choose appropriate tool):
- **Tap by key**: `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` with `find.byKey(ValueKey('btn')).first.tap()` via the gesture VM extension, or use marionette's `mcp__marionette__tap` if connected.
- **Enter text**: `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to set controller value, or `mcp__marionette__enter_text` for native keyboard input.
- **Scroll**: `mcp__marionette__scroll_to` with the target key.
- **Navigate programmatically**: `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` with `context.go('/route')`.

**Verify the result:**
- Call `mcp__plugin_flutter_flutter-ultra-runtime__find_widget` for an expected element on the next screen.
- Or call `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` to read state: `MyBloc.of(context).state.runtimeType.toString()`.
- If verification fails: call `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` and `mcp__plugin_flutter_flutter-ultra-runtime__get_logs` before reporting failure.

**Screenshot after major transitions** (not every micro-step):
- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` → save to `.omc/research/drive-<date>/<step-N>-<label>.png`.

### 4. Web OAuth / external popups (web target)

When a flow involves an external OAuth consent screen:
1. Call `mcp__plugin_flutter_flutter-ultra-browser__intercept_redirect` to capture the redirect URL.
2. Call `mcp__plugin_flutter_flutter-ultra-browser__navigate` to drive the external auth page.
3. Call `mcp__plugin_flutter_flutter-ultra-browser__fill` for username/password fields.
4. Call `mcp__plugin_flutter_flutter-ultra-browser__click` on the submit button.
5. Call `mcp__plugin_flutter_flutter-ultra-browser__wait_for_url` matching the app's redirect URI.
6. Re-attach to the Flutter runtime after the redirect completes.

### 5. Native mobile system dialogs (mobile target)

When the flow triggers OS-level permission dialogs or system sheets:
- Call `mcp__plugin_flutter_flutter-ultra-native-mobile__wait_for_native_element` to detect the dialog.
- Call `mcp__plugin_flutter_flutter-ultra-native-mobile__native_permission_grant` or `native_permission_deny`.
- Call `mcp__plugin_flutter_flutter-ultra-native-mobile__native_tap` for other system buttons.

### 6. Report the flow result

After all steps complete, produce:
- A numbered summary of steps taken, each with pass/fail status and the screenshot path if captured.
- Any errors encountered (with stack traces from `get_runtime_errors`).
- Final state description (current route, visible widget).

## Handling edge cases

- **Element not found**: call `get_widget_tree` from the root to find where the element actually is; the app may still be loading or may have navigated differently than expected. Wait up to 3 seconds in 500 ms increments by calling `evaluate` with `SchedulerBinding.instance.endOfFrame`.
- **App is on wrong route**: call `evaluate` with `GoRouter.of(context).routerDelegate.currentConfiguration.fullPath` to read current route, then navigate to the expected starting point.
- **Text field requires focus first**: tap the field before entering text; use `find_widget` to confirm it has focus via `hasFocus` property.
- **Async operations in progress**: check for loading indicators via `find_widget` with type `CircularProgressIndicator`; wait and retry.
- **Hot-reload after code change**: call `mcp__plugin_flutter_flutter-ultra-runtime__hot_reload` after any code edit, then re-verify the widget tree before continuing.

## Key tool reference

| Action | Tool |
|--------|------|
| Find element by key/text | `mcp__plugin_flutter_flutter-ultra-runtime__find_widget` |
| Inspect widget hierarchy | `mcp__plugin_flutter_flutter-ultra-runtime__get_widget_tree` |
| Run arbitrary Dart in-app | `mcp__plugin_flutter_flutter-ultra-runtime__evaluate` |
| Tap / enter text (marionette) | `mcp__marionette__tap`, `mcp__marionette__enter_text` |
| Scroll to element | `mcp__marionette__scroll_to` |
| Read runtime errors | `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` |
| Read app logs | `mcp__plugin_flutter_flutter-ultra-runtime__get_logs` |
| Screenshot | `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` |
| Web fill / click | `mcp__plugin_flutter_flutter-ultra-browser__fill`, `mcp__plugin_flutter_flutter-ultra-browser__click` |
| Wait for URL (OAuth) | `mcp__plugin_flutter_flutter-ultra-browser__wait_for_url` |
| Native permission grant | `mcp__plugin_flutter_flutter-ultra-native-mobile__native_permission_grant` |

## Example

```
User: "Drive the login flow for user@invora.app with password hunter2, then open the first invoice."

1. discover_sessions → attach(sessionId: "flutter-1")
2. screenshot → step-0-start.png (confirm login screen)
3. find_widget(key: "email-field") → found
4. evaluate: set email controller value to "user@invora.app"
5. find_widget(key: "password-field") → found
6. evaluate: set password controller value to "hunter2"
7. find_widget(key: "sign-in-button") → found; marionette tap(key: "sign-in-button")
8. evaluate: await SchedulerBinding.instance.endOfFrame (wait for navigation)
9. find_widget(key: "dashboard-root") → found (login succeeded)
10. screenshot → step-1-dashboard.png
11. evaluate: context.go('/invoices')
12. find_widget(text: "Invoice #1") → found; marionette tap(text: "Invoice #1")
13. find_widget(key: "invoice-detail-root") → found
14. screenshot → step-2-invoice-detail.png

Summary: 3 major steps completed, all passed. Final route: /invoices/1.
```

## See also

- Sibling skill: `flutter-tour` for passive route screenshot sweeps (no interaction)
- Sibling skill: `flutter-test` for orchestrated patrol E2E test runs
- `mcp__marionette__*` — native gesture and text tools via VM service extensions
