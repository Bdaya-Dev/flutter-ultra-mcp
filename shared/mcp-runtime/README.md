# @flutter-ultra/mcp-runtime

Shared MCP server scaffolding for the 8 flutter-ultra-\* servers. Encapsulates the patterns from plan §16 (conventions) and §17 (timeout resilience) so each server's `src/index.ts` stays small and focused on its tool catalogue.

**Status:** scaffold stub. Implementation owner: shared infra (wave 2).

Exports include:

- `createServer({ name, version, tools })` — boots stdio + handles initialize/shutdown
- `defineTool({ name, schema, handler, timeoutClass })` — Zod-validated, watchdog-wrapped
- `logger` — JSON-lines structured logging to stderr
- `withWatchdog` — timeout + cancellation wrapper per plan §17.4
- `progress(token, payload)` — `notifications/progress` helper per plan §16.4
