# @flutter-ultra/keyring

OS-keyring-backed secret storage for plugin-managed credentials: signing certs, OIDC tokens, Sentry DSNs.

**Status:** scaffold stub. Implementation owner: shared infra (wave 2).

Cross-platform via native APIs — Windows Credential Manager, macOS Keychain, Linux Secret Service. Plain-filesystem fallback is intentionally absent to preserve the plan §19 security guarantee.
