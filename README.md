# flutter-ultra-mcp

> Durable cross-platform Flutter automation for Claude Code — 8 specialized MCP servers, an in-app Dart mixin binding, and an optional DevTools panel. Replaces `marionette_mcp` and the official `dart mcp-server` with a crash-resilient multi-process architecture.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Plugin: Claude Code](https://img.shields.io/badge/Claude_Code-plugin-7C3AED.svg)](https://docs.claude.com/en/docs/claude-code)

## Why

A monolithic Flutter MCP server crashes badly: a malformed `pubspec.yaml` or a flaky AT-SPI binding takes down hot reload, gestures, browser, **and** native automation. We split the surface across **8 MCP servers** so a Linux AT-SPI regression cannot stop your Android tests, and a broken pubspec cannot block your hot reload.

| Server | Purpose |
|---|---|
| `flutter-ultra-build` | pubspec, codegen, analyze, format, tests, builds, l10n, assets |
| `flutter-ultra-runtime` | Attach to `flutter run` debug sessions over DDS; introspect VM Service |
| `flutter-ultra-gesture` | Tap, text entry, scroll, screenshot via in-app `ultra_flutter` mixin |
| `flutter-ultra-browser` | Playwright-driven web automation (OAuth redirects, popups, console) |
| `flutter-ultra-native-mobile` | Native overlays on Android (UIAutomator) + iOS (XCUITest) via adb / xcrun |
| `flutter-ultra-native-desktop` | Native UI on Windows (UIA), macOS (AX), Linux (AT-SPI) |
| `flutter-ultra-devtools` | Live MCP activity panel inside Flutter DevTools |
| `flutter-ultra-patrol` | Orchestrate `patrol_cli` for E2E tests (web + Android + iOS) |

## Install

This is a Claude Code plugin. Install with:

```bash
/plugin install Bdaya-Dev/flutter-ultra-mcp
```

Or add via the marketplace:

```bash
/plugin marketplace add Bdaya-Dev/flutter-ultra-mcp
/plugin install flutter
```

After install, the 8 MCP servers register automatically. Drop into any Flutter project, start a debug session, and ask Claude to take a screenshot, scroll a list, or run your patrol suite.

## Quick tour

```bash
# In a Flutter project
flutter run -d chrome

# Claude Code session — invoke any included skill
/flutter:tour          # Route-by-route screenshot tour
/flutter:drive         # Multi-step user flow automation
/flutter:debug         # Attach + inspect + triage
/flutter:test          # Test orchestration
/flutter:setup         # One-command setup in a new codebase
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full design.

## Documentation

- [Architecture](docs/architecture.md)
- [Contracts](docs/contracts/)
- [Platform matrix](docs/platform-matrix.md)
- [Migration from marionette_mcp](MIGRATION-marionette.md)
- [Discovery empirics](docs/discovery-empirics.md)
- [Upstream patrol PRs](docs/UPSTREAM-PATROL-PRS.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — commit message format, monorepo layout, local test workflow.

## Security

See [SECURITY.md](SECURITY.md) for the loopback-only design and the vulnerability reporting process.

## License

Apache-2.0. See [LICENSE](LICENSE) and the upstream notices in `NOTICE` (where applicable).
