import 'dart:convert';
import 'dart:io';

/// Standalone mock OIDC server for CI testing.
///
/// Run with: `dart run examples/oidc-app/lib/mock_oidc_server.dart`
///
/// Provides /authorize (redirect with code) and /token (returns mock JWT).
/// The flutter-ultra-browser MCP server uses Playwright to intercept the
/// redirect and complete the OAuth flow automatically.
Future<void> main() async {
  final server = await HttpServer.bind('localhost', 9980);
  print('Mock OIDC server listening on http://localhost:9980');

  await for (final request in server) {
    switch (request.uri.path) {
      case '/.well-known/openid-configuration':
        _jsonResponse(request, {
          'issuer': 'http://localhost:9980',
          'authorization_endpoint': 'http://localhost:9980/authorize',
          'token_endpoint': 'http://localhost:9980/token',
          'userinfo_endpoint': 'http://localhost:9980/userinfo',
          'jwks_uri': 'http://localhost:9980/.well-known/jwks.json',
          'response_types_supported': ['code'],
          'grant_types_supported': ['authorization_code'],
          'code_challenge_methods_supported': ['plain', 'S256'],
        });

      case '/authorize':
        final params = request.uri.queryParameters;
        final redirectUri = params['redirect_uri'] ?? '';
        final state = params['state'] ?? '';
        final callbackUrl = Uri.parse(redirectUri).replace(queryParameters: {
          'code': 'mock_code_${DateTime.now().millisecondsSinceEpoch}',
          'state': state,
        });
        request.response
          ..statusCode = HttpStatus.found
          ..headers.set('location', callbackUrl.toString())
          ..close();

      case '/token':
        final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
        _jsonResponse(request, {
          'access_token': 'mock_access_token_${DateTime.now().millisecondsSinceEpoch}',
          'token_type': 'Bearer',
          'expires_in': 3600,
          'id_token': _buildMockJwt(now),
        });

      case '/userinfo':
        _jsonResponse(request, {
          'sub': 'user-123',
          'name': 'Test User',
          'email': 'test@example.com',
        });

      default:
        request.response
          ..statusCode = HttpStatus.notFound
          ..write('Not found')
          ..close();
    }
  }
}

void _jsonResponse(HttpRequest request, Map<String, dynamic> body) {
  request.response
    ..statusCode = HttpStatus.ok
    ..headers.contentType = ContentType.json
    ..write(jsonEncode(body))
    ..close();
}

String _buildMockJwt(int now) {
  final header = base64Url.encode(utf8.encode(jsonEncode({
    'alg': 'RS256',
    'typ': 'JWT',
  })));
  final payload = base64Url.encode(utf8.encode(jsonEncode({
    'sub': 'user-123',
    'iss': 'http://localhost:9980',
    'aud': 'ultra-oidc-example',
    'iat': now,
    'exp': now + 3600,
    'name': 'Test User',
    'email': 'test@example.com',
  })));
  return '$header.$payload.mock_signature';
}
