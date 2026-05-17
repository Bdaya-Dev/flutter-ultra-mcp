# Counter App

Minimal Flutter counter demonstrating `ultra_flutter` binding integration.

Used as the primary E2E test fixture for the flutter-ultra-mcp plugin — all
platform-specific CI workflows drive this app to verify gesture, runtime, and
native automation servers.

## Running

```bash
flutter run -d chrome
```

In debug mode the `UltraFlutterBinding` is automatically initialized, exposing
`ext.flutter.ultra.*` VM service extensions that the MCP servers connect to.

## Widget Keys

| Key | Widget | Purpose |
|-----|--------|---------|
| `counter_value` | Text | Displays current count |
| `increment` | FAB | Increments counter |
| `decrement` | FAB | Decrements counter |
