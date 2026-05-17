# @flutter-ultra/flutter-ultra-browser

MCP server for **Playwright-driven browser automation**: navigate, click, fill, screenshot, console / network capture, OAuth redirect handling, and sandboxed Playwright scripts for Flutter web apps.

## Tools

| Tool                                                                     | Purpose                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launch_browser` / `close_browser`                                       | Lifecycle of a single per-session browser instance                                                                                                                                                |
| `new_context` / `new_tab`                                                | Cookie/storage-isolated contexts; pages within a context                                                                                                                                          |
| `navigate`                                                               | `page.goto(url)` with load wait                                                                                                                                                                   |
| `intercept_redirect` / `wait_for_url`                                    | Wait for navigation matching URL pattern; auth flows                                                                                                                                              |
| `click` / `fill` / `press_key`                                           | Interaction primitives by selector                                                                                                                                                                |
| `screenshot`                                                             | PNG screenshot of page or element (works on CanvasKit)                                                                                                                                            |
| `console_logs`                                                           | One-shot read of recent console events                                                                                                                                                            |
| `start_console_capture` / `get_console_capture` / `stop_console_capture` | **rev-23** persistent buffer of `console.*` + `pageerror` + `crash`, survives navigation, captures Dart `print()` on Flutter web within 100ms (AC-Br4)                                            |
| `network_requests`                                                       | Recent network events for a page                                                                                                                                                                  |
| `evaluate_js`                                                            | Run JS expression in page context, return JSON-serialized value                                                                                                                                   |
| `run_playwright_script`                                                  | **Sandboxed** Node `vm` execution of Playwright TS/JS with `page` / `context` / `browser` / `expect` / `console` / `fetch` exposed; **no** `process`/`require`/`import`; CPU + wall-time watchdog |
| `eval_playwright_recipe`                                                 | Run a named recipe from `${CLAUDE_PLUGIN_DATA}/recipes/*.ts`                                                                                                                                      |
| `set_storage` / `get_storage`                                            | Pre-seed / export cookies + localStorage                                                                                                                                                          |
| `link_to_flutter`                                                        | Associate this browser context with a Flutter sessionId (used by `/flutter:drive`)                                                                                                                |

See plan §5.4 lines 596-660 for the full design, AC-Br1..AC-Br4 acceptance criteria, and `run_playwright_script` sandbox boundary rationale.

State files this server owns:

- `${FLUTTER_ULTRA_STATE_DIR}/browsers.json` — active browser instances and their `link_to_flutter` mappings (plan §4)
- `${FLUTTER_ULTRA_STATE_DIR}/captures/console-<captureId>.jsonl` — append-only console event buffer per active capture (rev-23, survives server restart)
