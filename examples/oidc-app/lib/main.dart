import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:ultra_flutter/ultra_flutter.dart';

import 'oidc_service.dart';

void main() {
  if (!kReleaseMode) {
    UltraFlutterBinding.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const OidcApp());
}

class OidcApp extends StatelessWidget {
  const OidcApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Ultra OIDC',
      theme: ThemeData(
        colorSchemeSeed: Colors.teal,
        useMaterial3: true,
      ),
      home: const OidcHomePage(),
    );
  }
}

class OidcHomePage extends StatefulWidget {
  const OidcHomePage({super.key});

  @override
  State<OidcHomePage> createState() => _OidcHomePageState();
}

class _OidcHomePageState extends State<OidcHomePage> {
  final OidcService _oidc = OidcService();
  String? _accessToken;
  String? _error;
  bool _loading = false;

  Future<void> _login() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final token = await _oidc.login();
      setState(() => _accessToken = token);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  void _logout() {
    setState(() {
      _accessToken = null;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ultra OIDC Example')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (_loading)
                const CircularProgressIndicator(key: Key('loading_indicator'))
              else if (_accessToken != null) ...[
                const Icon(Icons.check_circle, color: Colors.green, size: 64),
                const SizedBox(height: 16),
                Text(
                  'Authenticated',
                  key: const Key('auth_status'),
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                SelectableText(
                  'Token: ${_accessToken!.substring(0, 20)}...',
                  key: const Key('token_preview'),
                ),
                const SizedBox(height: 24),
                FilledButton.tonal(
                  key: const Key('logout_button'),
                  onPressed: _logout,
                  child: const Text('Logout'),
                ),
              ] else ...[
                const Icon(Icons.lock_outline, size: 64),
                const SizedBox(height: 16),
                Text(
                  'Not authenticated',
                  key: const Key('auth_status'),
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    key: const Key('error_text'),
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  key: const Key('login_button'),
                  onPressed: _login,
                  child: const Text('Login with OIDC'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
