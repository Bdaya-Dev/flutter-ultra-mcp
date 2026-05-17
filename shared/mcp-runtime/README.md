# @flutter-ultra/mcp-runtime

Shared MCP server scaffolding for the flutter-ultra-mcp plugin's 8 servers.
Encapsulates the recurring patterns — stdio transport boot, Zod-validated
tools, watchdog/timeout enforcement, keep-alive against
[Claude Code #58004](https://github.com/anthropics/claude-code/issues/58004),
the cross-server session model, and the canonical FinderSpec for widget
lookups — so each server's `src/index.ts` stays focused on its tool catalogue.

## Quick start

```ts
import { createServer } from '@flutter-ultra/mcp-runtime';
import { z } from 'zod';

const server = createServer({
  info: { name: 'flutter-ultra-runtime', version: '0.0.1' },
});

server.defineTool(
  {
    name: 'list_sessions',
    description: 'List active Flutter sessions attached by this server.',
    timeoutClass: 'instant',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => ({
    sessions: [
      /* ... */
    ],
  }),
);

server.defineTool(
  {
    name: 'hot_reload',
    description: 'Trigger a hot reload on the given session.',
    inputShape: { sessionId: z.string().min(8) },
    timeoutClass: 'quick',
    ceilingMs: 60_000,
  },
  async ({ sessionId }, { signal, sendProgress }) => {
    sendProgress({ progress: 0, message: 'Sending reloadSources to VM service' });
    // ... handler body with signal-aware aborts
    return { ok: true, sessionId };
  },
);

await server.start();
process.on('SIGTERM', () => server.stop());
```

## Components

| Module         | Exports                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `server.ts`    | `createServer`, `defineTool` — high-level builder over `@modelcontextprotocol/sdk`                     |
| `watchdog.ts`  | `runWithWatchdog`, `TimeoutClass`, `DEFAULT_CEILINGS_MS` — per-tool hard cap + AbortSignal propagation |
| `keepAlive.ts` | `startKeepAlive` — periodic `notifications/message` debug ping (plan §17.9)                            |
| `logger.ts`    | `createLogger` — JSON-lines stderr logger with per-tool child loggers                                  |
| `session.ts`   | `Session`, `SessionResource`, `SessionsFile` — cross-server session model                              |
| `finder.ts`    | `FinderSchema`, `FinderSpec`, `matchesText` — shared discriminated union for widget lookups            |
| `errors.ts`    | `ToolWatchdogTimeoutError`, `SessionNotFoundError`, etc.                                               |

## Timeout classes (plan §17.2)

| Class      | Ceiling | When to use                                                        |
| ---------- | ------- | ------------------------------------------------------------------ |
| `instant`  | 10 s    | < 1 s p95: `list_sessions`, `get_widget_tree` on small trees       |
| `quick`    | 30 s    | 1–5 s p95: `hot_reload`, `screenshot`, `tap`                       |
| `long`     | 55 s    | 5–55 s p95: `dump_render_tree`, `wait_for` (always emit progress)  |
| `marathon` | 55 s    | > 55 s: MUST be split-tool (`start_*` / `poll_*` / `get_*_result`) |

Per-tool override via env var: `FLUTTER_ULTRA_TOOL_TIMEOUT_<NAME_UPPER>=120000`.

## Session model

Sessions live as JSON in `${CLAUDE_PLUGIN_DATA}/state/sessions.json` (path
resolved by `@flutter-ultra/state-store`). The runtime server is the sole
writer; gesture / devtools / patrol read-only. Each session carries:

```
{ id, uri, source, clientName, attachedAt, lastSeenAt,
  status, pid?, projectRoot?, device?, isolateIds?, appName? }
```

`SessionResource<T>` reference-counts an expensive per-session resource
(e.g. the `VmServiceClient` WebSocket) so multiple parallel tool calls
share one connection per plan §17.10.

## FinderSpec

Discriminated union used by both runtime (`widget_exists`, `find_widget`)
and gesture (`tap`, `enter_text`, `wait_for`) so an agent's "is the widget
in the tree?" check uses the exact same matcher as the subsequent tap:

```ts
type FinderSpec =
  | { kind: 'key'; value: string }
  | {
      kind: 'text';
      value: string;
      matchType?: 'exact' | 'contains' | 'regex';
      caseInsensitive?: boolean;
    }
  | { kind: 'type'; value: string }
  | { kind: 'coords'; x: number; y: number }
  | { kind: 'semanticsLabel'; value: string; matchType?: 'exact' | 'contains' | 'regex' }
  | { kind: 'tooltip'; value: string; matchType?: 'exact' | 'contains' | 'regex' };
```

`matchesText(candidate, spec)` is the shared comparator both consumers use.

## License

Apache-2.0. See [LICENSE](../../LICENSE).
