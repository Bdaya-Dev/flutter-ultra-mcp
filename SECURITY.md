# Security Policy

## Reporting a vulnerability

Please report suspected security issues privately via GitHub Security Advisories:

https://github.com/Bdaya-Dev/flutter-ultra-mcp/security/advisories/new

Do not open public issues for security reports.

## Design posture

flutter-ultra-mcp is local-only by design. The 8 MCP servers communicate with their target Flutter apps and helper processes over **loopback transports only** (Unix sockets, named pipes, localhost WebSocket). No server in the plugin opens a non-loopback listener.

Secrets handled by the plugin (signing certs, OIDC tokens, etc.) are stored via the OS keyring through `@flutter-ultra/keyring` and are never written to the filesystem in plaintext.

## Supported versions

Only the latest published release on the `main` branch receives security updates.
