import 'dart:async';
import 'dart:convert';
import 'dart:io' show HttpServer, HttpStatus;
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

/// Demonstrates OIDC PKCE authorization code flow.
///
/// In CI, uses the mock server at `OIDC_MOCK_URL` env var (defaults to
/// localhost:9980). In production you'd point to a real Zitadel/Auth0/etc.
class OidcService {
  static const _mockIssuer = 'http://localhost:9980';
  static const _clientId = 'ultra-oidc-example';
  static const _redirectPort = 9981;
  static const _redirectUri = 'http://localhost:$_redirectPort/callback';

  String get issuer {
    const env = String.fromEnvironment('OIDC_ISSUER', defaultValue: '');
    return env.isEmpty ? _mockIssuer : env;
  }

  Future<String> login() async {
    final state = _generateRandom(32);
    final codeVerifier = _generateRandom(64);

    final authUrl = Uri.parse('$issuer/authorize').replace(queryParameters: {
      'response_type': 'code',
      'client_id': _clientId,
      'redirect_uri': _redirectUri,
      'scope': 'openid profile email',
      'state': state,
      'code_challenge': codeVerifier,
      'code_challenge_method': 'plain',
    });

    final code = await _listenForCallback(state);

    if (kIsWeb) {
      await launchUrl(authUrl, mode: LaunchMode.platformDefault);
    } else {
      await launchUrl(authUrl, mode: LaunchMode.externalApplication);
    }

    final authCode = await code;
    return _exchangeCode(authCode, codeVerifier);
  }

  Future<String> _listenForCallback(String expectedState) async {
    final completer = Completer<String>();

    if (kIsWeb) {
      // On web, the redirect comes back to the same window.
      // The MCP browser server intercepts this via Playwright.
      // For the example, we simulate with a delayed mock token.
      Future.delayed(const Duration(seconds: 1), () {
        completer.complete('mock_auth_code_web');
      });
      return completer.future;
    }

    final server = await HttpServer.bind('localhost', _redirectPort);
    server.listen((request) {
      if (request.uri.path == '/callback') {
        final returnedState = request.uri.queryParameters['state'];
        final code = request.uri.queryParameters['code'];

        if (returnedState == expectedState && code != null) {
          request.response
            ..statusCode = HttpStatus.ok
            ..headers.contentType = null
            ..write('<!DOCTYPE html><html><body>'
                '<h1>Authentication successful</h1>'
                '<p>You can close this window.</p>'
                '</body></html>')
            ..close();
          completer.complete(code);
        } else {
          request.response
            ..statusCode = HttpStatus.badRequest
            ..write('State mismatch or missing code')
            ..close();
          completer.completeError(Exception('OAuth state mismatch'));
        }
        server.close();
      }
    });

    return completer.future.timeout(
      const Duration(seconds: 120),
      onTimeout: () {
        server.close();
        throw TimeoutException('OIDC callback timed out after 120s');
      },
    );
  }

  Future<String> _exchangeCode(String code, String codeVerifier) async {
    // In a real app, POST to $issuer/token with the code + verifier.
    // For this example, we return a mock JWT-like token.
    await Future.delayed(const Duration(milliseconds: 200));
    return 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.'
        '${base64Url.encode(utf8.encode(jsonEncode({
          'sub': 'user-123',
          'iss': issuer,
          'aud': _clientId,
          'exp': DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch ~/ 1000,
        })))}'
        '.mock_signature';
  }

  String _generateRandom(int length) {
    final rng = Random.secure();
    final bytes = List.generate(length, (_) => rng.nextInt(256));
    return base64Url.encode(bytes).substring(0, length);
  }
}
