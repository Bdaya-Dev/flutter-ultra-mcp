---
name: setup-declarative-routing
description: Configure `MaterialApp.router` using a package like `go_router` for advanced URL-based navigation. Use when developing web applications or mobile apps that require specific deep linking and browser history support.
---

# Implementing Routing and Deep Linking

## Contents

- [Core Concepts](#core-concepts)
- [Workflow: Initializing the Application and Router](#workflow-initializing-the-application-and-router)
- [Workflow: Configuring Platform Deep Linking](#workflow-configuring-platform-deep-linking)
- [Workflow: Implementing Nested Navigation](#workflow-implementing-nested-navigation)
- [Examples](#examples)

## Core Concepts

Use the `go_router` package for declarative routing in Flutter.

- **GoRouter**: Central configuration object defining the route tree.
- **GoRoute**: Maps a URL path to a Flutter screen.
- **ShellRoute / StatefulShellRoute**: Wraps child routes in a persistent UI shell (e.g., `BottomNavigationBar`). `StatefulShellRoute` maintains state of parallel branches.
- **Path URL Strategy**: Removes the default `#` from web URLs.

## Workflow: Initializing the Application and Router

### Task Progress

- [ ] Create the Flutter application.
- [ ] Add `go_router`: `flutter pub add go_router`.
- [ ] Configure URL strategy with `usePathUrlStrategy()`.
- [ ] Implement the `GoRouter` configuration.
- [ ] Bind the router to `MaterialApp.router`.

```dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_web_plugins/url_strategy.dart';

void main() {
  usePathUrlStrategy();
  runApp(const MyApp());
}

final GoRouter _router = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
      routes: [
        GoRoute(
          path: 'details/:id',
          builder: (context, state) => DetailsScreen(id: state.pathParameters['id']!),
        ),
      ],
    ),
  ],
  errorBuilder: (context, state) => ErrorScreen(error: state.error),
);

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(routerConfig: _router, title: 'Routing App');
  }
}
```

## Workflow: Configuring Platform Deep Linking

### Task Progress

- [ ] Determine target platforms (iOS, Android, or both).
- [ ] **Android:** Add intent filter to `AndroidManifest.xml` + host `assetlinks.json`.
- [ ] **iOS:** Set `FlutterDeepLinkingEnabled` in `Info.plist` + add associated domain in entitlements + host `apple-app-site-association`.
- [ ] Test via ADB (Android) or `xcrun simctl openurl` (iOS).

## Workflow: Implementing Nested Navigation

Use `StatefulShellRoute.indexedStack` to implement persistent shells with tab navigation.

```dart
final GoRouter _router = GoRouter(
  initialLocation: '/home',
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) {
        return ScaffoldWithNavBar(navigationShell: navigationShell);
      },
      branches: [
        StatefulShellBranch(routes: [
          GoRoute(path: '/home', builder: (context, state) => const HomeScreen()),
        ]),
        StatefulShellBranch(routes: [
          GoRoute(path: '/settings', builder: (context, state) => const SettingsScreen()),
        ]),
      ],
    ),
  ],
);
```

## Examples

### Programmatic Navigation

```dart
context.go('/details/123');        // Replace current stack
context.push('/details/123');      // Push onto stack
context.goNamed('details', pathParameters: {'id': '123'});
context.pop();
```

### Shell Widget Implementation

```dart
class ScaffoldWithNavBar extends StatelessWidget {
  const ScaffoldWithNavBar({required this.navigationShell, super.key});
  final StatefulNavigationShell navigationShell;

  void _goBranch(int index) {
    navigationShell.goBranch(index,
      initialLocation: index == navigationShell.currentIndex);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: _goBranch,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}
```

## Flutter Ultra Integration

After configuring routes, test navigation in the running app:

- `mcp__plugin_flutter_flutter-ultra-runtime__launch_app` — Launch the app to test routing
- `mcp__plugin_flutter_flutter-ultra-browser__navigate` — Navigate to specific routes in the browser (web targets)
- `mcp__plugin_flutter_flutter-ultra-runtime__screenshot` — Capture each route for visual verification
- `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` — Check for routing errors (missing routes, redirect loops)

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
