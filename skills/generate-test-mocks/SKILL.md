---
name: generate-test-mocks
description: Define and generate mock objects for external dependencies using `package:mockito` and `build_runner`. Use when unit testing classes that depend on complex external services like APIs or databases.
---

# Testing and Mocking Dart Applications

## Contents

- [Structuring Code for Testability](#structuring-code-for-testability)
- [Managing Dependencies](#managing-dependencies)
- [Generating Mocks](#generating-mocks)
- [Implementing Unit Tests](#implementing-unit-tests)
- [Workflow: Creating and Running Mocked Tests](#workflow-creating-and-running-mocked-tests)
- [Examples](#examples)

## Structuring Code for Testability

Design Dart classes to support dependency injection. Isolate complex external dependencies so they can be replaced with mock objects during testing.

- Inject external services (e.g., `http.Client`) through class constructors.
- Represent URLs strictly as `Uri` objects using `Uri.parse(string)`.

## Managing Dependencies

Configure the `pubspec.yaml` file with the necessary testing and code generation packages.

- Add runtime dependencies (e.g., `package:http`) using `dart pub add http`.
- Add testing dependencies using `dart pub add dev:test dev:mockito dev:build_runner`.
- Import HTTP libraries with a prefix: `import 'package:http/http.dart' as http;`.

## Generating Mocks

Use `package:mockito` and `build_runner` to automatically generate mock classes.

- Always use the `@GenerateNiceMocks` annotation (preferable to `@GenerateMocks`).
- Place the annotation in the test file, passing a list of `MockSpec<Type>()` objects.
- Import the generated file using the `.mocks.dart` extension.
- Execute `build_runner` to generate the mock files: `dart run build_runner build`.

## Implementing Unit Tests

Isolate the system under test using the generated mock objects.

- **Stubbing:** Use `when(mock.method()).thenReturn(value)` for synchronous methods.
- **CRITICAL:** Always use `thenAnswer((_) async => value)` for methods returning a `Future` or `Stream`. Never use `thenReturn` for asynchronous returns.
- **Verification:** Use `verify(mock.method()).called(1)` to check exact invocation counts.

## Workflow: Creating and Running Mocked Tests

### Task Progress

- [ ] 1. Identify the external dependency to mock.
- [ ] 2. Inject the dependency into the target class constructor.
- [ ] 3. Create a test file and add `@GenerateNiceMocks([MockSpec<Dependency>()])`.
- [ ] 4. Add the import directive for the generated `.mocks.dart` file.
- [ ] 5. Run `dart run build_runner build` to generate the mock classes.
- [ ] 6. Write the test cases using `group()` and `test()`.
- [ ] 7. Stub required behaviors using `when()`.
- [ ] 8. Execute the target method.
- [ ] 9. Verify interactions using `verify()` and assert outcomes using `expect()`.
- [ ] 10. Run the test suite using `dart test`.

## Examples

### High-Fidelity Mocking and Testing Example

**System Under Test (`lib/api_service.dart`):**

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiService {
  final http.Client client;
  ApiService(this.client);

  Future<String> fetchData(String urlString) async {
    final uri = Uri.parse(urlString);
    final response = await client.get(uri);
    if (response.statusCode == 200) {
      return jsonDecode(response.body)['data'];
    } else {
      throw Exception('Failed to load data');
    }
  }
}
```

**Test Implementation (`test/api_service_test.dart`):**

```dart
import 'package:test/test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:http/http.dart' as http;
import 'package:my_app/api_service.dart';

@GenerateNiceMocks([MockSpec<http.Client>()])
import 'api_service_test.mocks.dart';

void main() {
  group('ApiService', () {
    late ApiService apiService;
    late MockClient mockHttpClient;

    setUp(() {
      mockHttpClient = MockClient();
      apiService = ApiService(mockHttpClient);
    });

    test('returns data if the http call completes successfully', () async {
      when(mockHttpClient.get(any)).thenAnswer(
        (_) async => http.Response('{"data": "Success"}', 200),
      );

      final result = await apiService.fetchData('https://api.example.com/data');
      expect(result, 'Success');
      verify(mockHttpClient.get(Uri.parse('https://api.example.com/data'))).called(1);
    });

    test('throws an exception if the http call completes with an error', () {
      when(mockHttpClient.get(any)).thenAnswer(
        (_) async => http.Response('Not Found', 404),
      );

      expect(
        apiService.fetchData('https://api.example.com/data'),
        throwsException,
      );
    });
  });
}
```

## Flutter Ultra Integration

Run build_runner to generate mock classes:

- `mcp__plugin_flutter_flutter-ultra-build__start_build_runner_build` — Run build_runner to generate \*.mocks.dart files
- `mcp__plugin_flutter_flutter-ultra-build__poll_build_runner_job` — Monitor generation progress
- `mcp__plugin_flutter_flutter-ultra-build__get_build_runner_result` — Check for generation errors

---

> **Attribution:** This skill is vendored from [dart-lang/skills](https://github.com/dart-lang/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.
