# ultra_flutter_sentry_compat

Compatibility mixin that lets `ultra_flutter` coexist with `SentryWidgetsFlutterBinding` in the same Flutter app.

**Status:** scaffold stub. Implementation owner: **wave-1 worker-B** (see plan §6.1 Path B, task #2).

Add this alongside `ultra_flutter` only when the host app already uses Sentry — otherwise the base `UltraFlutterBinding` mixin is enough.
