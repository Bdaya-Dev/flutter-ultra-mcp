# Upstream Sentry PR — expose `SentryWidgetsBindingMixin`

## Status

**Not filed yet.** Tracked as Path A per `flutter-ultra-mcp-v1.md` §6.1.
Filing this PR is opportunistic cleanup, not a blocker for v1.

## Current state

`package:sentry_flutter/sentry_flutter.dart` (v9.20.0) declares:

```dart
export 'src/binding_wrapper.dart'
    show BindingWrapper, SentryWidgetsFlutterBinding;
```

The `show` clause hides `SentryWidgetsBindingMixin` from the public API
even though the mixin is defined in the same file. Consumers reach it via a
deliberate `// ignore: implementation_imports` import of
`package:sentry_flutter/src/binding_wrapper.dart`.

## Proposed change

Extend the `show` clause to include the mixin:

```dart
export 'src/binding_wrapper.dart'
    show BindingWrapper, SentryWidgetsFlutterBinding, SentryWidgetsBindingMixin;
```

The mixin is already used as a typedef inside other public Sentry classes,
so exposing it is a non-breaking change.

## Motivation

Composability. Multiple Flutter ecosystem packages (testing harnesses,
debug bindings, AI-agent automation like ultra_flutter) need to mix
Sentry's binding instrumentation alongside their own. Today they either:

1. Subclass `SentryWidgetsFlutterBinding` (cannot also compose another
   `WidgetsFlutterBinding` subclass — Dart `with` requires a mixin), OR
2. Reach into `package:sentry_flutter/src/binding_wrapper.dart` directly
   with `// ignore: implementation_imports` (brittle, breaks the visibility
   contract).

Making the mixin public moves option 2 from "private reach-through" to
"sanctioned composition".

## Risks

- Surface-area expansion: once public, the mixin name + signature are
  versioned. Sentry maintainers would need to follow semver on it.
- Misuse: users might mix the mixin onto unusual base classes and hit
  internal-state assumptions. Counter: the mixin already encapsulates its
  state cleanly (`_isTrackingActive`, `_options`, etc.) and gracefully
  degrades when the rest of Sentry isn't wired.

## When to file

After `ultra_flutter` ships v1.0 and we have at least one real consumer
(Invora) demonstrating the composition pattern. PR will reference the
ultra_flutter use case as the concrete motivation.
