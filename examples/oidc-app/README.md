# OIDC App

Flutter example demonstrating OIDC PKCE authorization code flow with a mock
identity provider, used to verify the flutter-ultra-browser MCP server's OAuth
interception and CCT (Custom Chrome Tab) OAuth solver on mobile.

## Architecture

```
[Flutter App] --launch--> [Browser: /authorize]
                              |
                        [Mock OIDC Server]
                              |
                        [302 → localhost:9981/callback]
                              |
[Flutter App] <--code----- [Local HTTP server]
```

## Running

1. Start the mock OIDC server:
   ```bash
   dart run lib/mock_oidc_server.dart
   ```

2. Run the Flutter app:
   ```bash
   flutter run -d chrome
   ```

3. Click "Login with OIDC" — the browser server intercepts the redirect.

## Widget Keys

| Key | Widget | Purpose |
|-----|--------|---------|
| `login_button` | FilledButton | Initiates OIDC flow |
| `logout_button` | FilledButton.tonal | Clears token |
| `auth_status` | Text | Shows "Authenticated" or "Not authenticated" |
| `token_preview` | SelectableText | Truncated token display |
| `loading_indicator` | CircularProgressIndicator | During OAuth exchange |
| `error_text` | Text | Error message |

## CI Usage

The `ci-e2e-web.yml` workflow starts `mock_oidc_server.dart` as a background
process, then drives the app via Playwright to complete the full OAuth flow
end-to-end.
