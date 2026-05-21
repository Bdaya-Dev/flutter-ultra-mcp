---
name: use-http-package
description: Use the `http` package to execute GET, POST, PUT, or DELETE requests. Use when you need to fetch from or send data to a REST API.
---

# Implementing Flutter Networking

## Contents

- [Configuration & Permissions](#configuration--permissions)
- [Request Execution & Response Handling](#request-execution--response-handling)
- [Background Parsing](#background-parsing)
- [Workflow: Executing Network Operations](#workflow-executing-network-operations)
- [Examples](#examples)

## Configuration & Permissions

1. Add the `http` package: `flutter pub add http`
2. Import: `import 'package:http/http.dart' as http;`
3. **Android**: Add `<uses-permission android:name="android.permission.INTERNET" />` to `AndroidManifest.xml`.
4. **macOS**: Add `com.apple.security.network.client` = `true` to both entitlements files.

## Request Execution & Response Handling

- **URIs:** Always use `Uri.parse('your_url')`.
- **Headers:** Inject via the `headers` parameter map.
- **Payloads:** For POST/PUT, encode body with `jsonEncode()`.
- **Status Validation:** Treat `200 OK` (GET/PUT/DELETE) and `201 CREATED` (POST) as success.
- **Error Handling:** Throw explicit exceptions on non-success codes. Never return `null`.
- **Deserialization:** `jsonDecode(response.body)` then map to model's `fromJson`.

## Background Parsing

For large payloads (>16ms parse time), use `compute()` from `package:flutter/foundation.dart` to parse in a background isolate. The parsing function must be top-level or static.

## Workflow: Executing Network Operations

**Task Progress:**

- [ ] 1. Define strongly typed Dart model with `fromJson`.
- [ ] 2. Implement network request method returning `Future<Model>`.
- [ ] 3. Apply conditional logic:
  - **GET**: Append query parameters to URI.
  - **POST/PUT**: Set `Content-Type: application/json; charset=UTF-8`, attach `jsonEncode` body.
  - **DELETE**: Return empty model instance on success.
- [ ] 4. Validate `statusCode` and throw `Exception` on failure.
- [ ] 5. Integrate into UI using `FutureBuilder`.
- [ ] 6. Handle `snapshot.hasData`, `snapshot.hasError`, default to `CircularProgressIndicator`.
- [ ] 7. Run app -> trigger request -> review console for exceptions -> fix.

## Examples

### Fetching and Parsing in the Background

```dart
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

List<Photo> parsePhotos(String responseBody) {
  final parsed = (jsonDecode(responseBody) as List<Object?>)
      .cast<Map<String, Object?>>();
  return parsed.map<Photo>(Photo.fromJson).toList();
}

Future<List<Photo>> fetchPhotos() async {
  final response = await http.get(
    Uri.parse('https://jsonplaceholder.typicode.com/photos'),
    headers: {
      HttpHeaders.authorizationHeader: 'Bearer your_token_here',
      HttpHeaders.acceptHeader: 'application/json',
    },
  );

  if (response.statusCode == 200) {
    return compute(parsePhotos, response.body);
  } else {
    throw Exception('Failed to load photos. Status: ${response.statusCode}');
  }
}

class Photo {
  final int id;
  final String title;
  final String thumbnailUrl;

  const Photo({required this.id, required this.title, required this.thumbnailUrl});

  factory Photo.fromJson(Map<String, dynamic> json) {
    return Photo(
      id: json['id'] as int,
      title: json['title'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String,
    );
  }
}

class PhotoGallery extends StatefulWidget {
  const PhotoGallery({super.key});
  @override
  State<PhotoGallery> createState() => _PhotoGalleryState();
}

class _PhotoGalleryState extends State<PhotoGallery> {
  late Future<List<Photo>> _futurePhotos;

  @override
  void initState() {
    super.initState();
    _futurePhotos = fetchPhotos();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Photo>>(
      future: _futurePhotos,
      builder: (context, snapshot) {
        if (snapshot.hasData) {
          final photos = snapshot.data!;
          return ListView.builder(
            itemCount: photos.length,
            itemBuilder: (context, index) => ListTile(
              leading: Image.network(photos[index].thumbnailUrl),
              title: Text(photos[index].title),
            ),
          );
        } else if (snapshot.hasError) {
          return Center(child: Text('Error: ${snapshot.error}'));
        }
        return const Center(child: CircularProgressIndicator());
      },
    );
  }
}
```

## Flutter Ultra Integration

Monitor and debug HTTP calls in the running app:

- `mcp__plugin_flutter_flutter-ultra-runtime__start_http_capture` — Start capturing HTTP traffic
- `mcp__plugin_flutter_flutter-ultra-runtime__get_http_events` — View captured HTTP requests and responses
- `mcp__plugin_flutter_flutter-ultra-runtime__stop_http_capture` — Stop HTTP capture
- `mcp__plugin_flutter_flutter-ultra-runtime__get_runtime_errors` — Check for unhandled HTTP exceptions

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
