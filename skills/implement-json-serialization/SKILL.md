---
name: implement-json-serialization
description: Create model classes with `fromJson` and `toJson` methods using `dart:convert`. Use when manually mapping JSON keys to class properties for simple data structures.
---

# Serializing JSON Manually in Flutter

## Contents

- [Core Guidelines](#core-guidelines)
- [Workflow: Implementing a Serializable Model](#workflow-implementing-a-serializable-model)
- [Workflow: Fetching and Parsing JSON](#workflow-fetching-and-parsing-json)
- [Examples](#examples)

## Core Guidelines

- **Import `dart:convert`**: Use `jsonEncode` and `jsonDecode`.
- **Enforce Type Safety**: Cast `jsonDecode()` result to `Map<String, dynamic>` or `List<dynamic>`.
- **Encapsulate Logic**: Define `fromJson` factory constructor and `toJson` method in model classes.
- **Handle Background Parsing**: If parsing takes >16ms, use `compute()` to prevent UI jank.
- **Throw on Failure**: Throw an exception on non-success HTTP status codes. Do not return `null`.

## Workflow: Implementing a Serializable Model

**Task Progress:**

- [ ] Define the plain model class with `final` properties.
- [ ] Implement `factory Model.fromJson(Map<String, dynamic> json)`.
- [ ] Implement `Map<String, dynamic> toJson()`.
- [ ] Write unit tests for both methods.
- [ ] Run validator -> review type mismatch errors -> fix casting logic.

## Workflow: Fetching and Parsing JSON

**Task Progress:**

- [ ] Execute the HTTP request.
- [ ] Validate the response status code.
- [ ] Determine parsing strategy:
  - **Small payload**: Parse synchronously on the main thread.
  - **Large payload**: Use `compute(parseFunction, response.body)`.
- [ ] Decode and map the JSON to the model.

## Examples

### Model Implementation

```dart
import 'dart:convert';

class User {
  final int id;
  final String name;
  final String email;

  const User({required this.id, required this.name, required this.email});

  factory User.fromJson(Map<String, dynamic> json) {
    return switch (json) {
      {'id': int id, 'name': String name, 'email': String email} =>
        User(id: id, name: name, email: email),
      _ => throw const FormatException('Failed to load User.'),
    };
  }

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'email': email};
}
```

### Background Parsing (Large Payload)

```dart
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

List<User> parseUsers(String responseBody) {
  final parsed = (jsonDecode(responseBody) as List<dynamic>).cast<Map<String, dynamic>>();
  return parsed.map<User>((json) => User.fromJson(json)).toList();
}

Future<List<User>> fetchUsers(http.Client client) async {
  final response = await client.get(Uri.parse('https://api.example.com/users'));
  if (response.statusCode == 200) {
    return compute(parseUsers, response.body);
  } else {
    throw Exception('Failed to load users');
  }
}
```

## Flutter Ultra Integration

If using code generation (json_serializable), run the build runner:

- `mcp__plugin_flutter_flutter-ultra-build__start_build_runner_build` — Run build_runner to generate serialization code
- `mcp__plugin_flutter_flutter-ultra-build__poll_build_runner_job` — Monitor code generation progress
- `mcp__plugin_flutter_flutter-ultra-build__analyze` — Verify generated code has no analysis errors

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
