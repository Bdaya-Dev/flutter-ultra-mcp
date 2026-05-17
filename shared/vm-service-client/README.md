# @flutter-ultra/vm-service-client

TypeScript Dart VM Service client with DDS multi-client coordination. Backs the runtime, gesture, devtools, and patrol servers.

**Status:** scaffold stub. Implementation owner: **wave-1 worker-C** (see plan §12, task #3).

Mirrors the schema of [package:vm_service](https://pub.dev/packages/vm_service) and adds:
- DDS WebSocket coordination (multi-client fan-out, log history replay)
- Service-extension catalogue for `ext.flutter.ultra.*`
- Typed event subscriptions (`Stdout`, `Stderr`, `Logging`, `Extension`)
