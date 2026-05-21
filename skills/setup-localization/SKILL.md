---
name: setup-localization
description: Add `flutter_localizations` and `intl` dependencies, enable "generate true" in `pubspec.yaml`, and create an `l10n.yaml` configuration file. Use when initializing localization support for a new Flutter project.
---

# Internationalizing Flutter Applications

## Contents

- [Core Concepts](#core-concepts)
- [Setup Workflow](#setup-workflow)
- [Implementation Workflow](#implementation-workflow)
- [Advanced Formatting](#advanced-formatting)
- [Examples](#examples)

## Core Concepts

Flutter handles i18n/l10n via `flutter_localizations` and `intl`. Uses App Resource Bundle (`.arb`) files compiled into a generated `AppLocalizations` class for type-safe access.

## Setup Workflow

- [ ] 1. Add dependencies to `pubspec.yaml`.
- [ ] 2. Enable the `generate` flag.
- [ ] 3. Create the `l10n.yaml` configuration file.
- [ ] 4. Configure `MaterialApp` or `CupertinoApp`.

### 1. Add Dependencies

```bash
flutter pub add flutter_localizations --sdk=flutter
flutter pub add intl:any
```

### 2. Enable Code Generation

```yaml
# pubspec.yaml
flutter:
  generate: true
```

### 3. Create Configuration File

```yaml
# l10n.yaml
arb-dir: lib/l10n
template-arb-file: app_en.arb
output-localization-file: app_localizations.dart
synthetic-package: true
```

### 4. Configure App Entry Point

```dart
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';

return MaterialApp(
  localizationsDelegates: const [
    AppLocalizations.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  supportedLocales: const [Locale('en'), Locale('es')],
  home: const MyHomePage(),
);
```

## Implementation Workflow

### 1. Define ARB Files

**Template (`lib/l10n/app_en.arb`):**

```json
{
  "helloWorld": "Hello World!",
  "@helloWorld": {
    "description": "The conventional newborn programmer greeting"
  }
}
```

**Other locales (`lib/l10n/app_es.arb`):**

```json
{
  "helloWorld": "!Hola Mundo!"
}
```

### 2. Generate Localization Classes

```bash
flutter pub get
```

### 3. Consume Localized Strings

```dart
Text(AppLocalizations.of(context)!.helloWorld)
```

## Advanced Formatting

### Placeholders

```json
"hello": "Hello {userName}",
"@hello": {
  "placeholders": {
    "userName": { "type": "String", "example": "Bob" }
  }
}
```

### Plurals

```json
"nWombats": "{count, plural, =0{no wombats} =1{1 wombat} other{{count} wombats}}",
"@nWombats": {
  "placeholders": { "count": { "type": "num", "format": "compact" } }
}
```

### Selects

```json
"pronoun": "{gender, select, male{he} female{she} other{they}}",
"@pronoun": {
  "placeholders": { "gender": { "type": "String" } }
}
```

## Examples

### Complete Widget Implementation

```dart
import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';

class GreetingWidget extends StatelessWidget {
  final String userName;
  final int notificationCount;

  const GreetingWidget({
    super.key,
    required this.userName,
    required this.notificationCount,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(children: [
      Text(l10n.hello(userName)),
      Text(l10n.nWombats(notificationCount)),
    ]);
  }
}
```

## Flutter Ultra Integration

Generate and validate localization files with these tools:

- `mcp__plugin_flutter_flutter-ultra-build__flutter_gen_l10n` — Generate localization Dart code from ARB files
- `mcp__plugin_flutter_flutter-ultra-build__list_missing_translations` — Find missing translation keys across locales
- `mcp__plugin_flutter_flutter-ultra-build__arb_add_key` — Add a new translation key to all ARB files
- `mcp__plugin_flutter_flutter-ultra-build__arb_diff` — Compare ARB files to find drift between locales

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
