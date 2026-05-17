# @flutter-ultra/state-store

File-based IPC for the flutter-ultra-mcp plugin's 8 servers. Atomic
read-modify-write of JSON state files via [`proper-lockfile`](https://www.npmjs.com/package/proper-lockfile),
plus an append-only JSONL writer for streams (log tails, screencast frames).

## Why files, not a daemon

Each MCP server is a separate process spawned by Claude Code. A daemon would
add another moving part with its own failure surface; the file model means:

- **No bootstrap order**: servers start independently.
- **Survives restarts**: state persists when a single server crashes and is
  re-spawned.
- **Cross-tool inspection**: `cat ${CLAUDE_PLUGIN_DATA}/state/sessions.json`
  works as a debugging primitive.

## Storage layout

```
${CLAUDE_PLUGIN_DATA}/state/
  sessions.json              ← runtime server writes, others read
  jobs/<jobId>.json          ← split-tool job state (build_runner_build, etc.)
  streams/<streamId>.jsonl   ← append-only event streams (tail_logs, etc.)
  locks/                     ← proper-lockfile metadata
```

`CLAUDE_PLUGIN_DATA` is set by Claude Code; otherwise we fall back to
`%LOCALAPPDATA%/flutter-ultra-mcp` (Windows),
`~/Library/Application Support/flutter-ultra-mcp` (macOS),
`$XDG_DATA_HOME/flutter-ultra-mcp` (Linux).

## API

```ts
import { stateUpdate, stateRead, sessionsFilePath } from '@flutter-ultra/state-store';
import { SessionsFileSchema, emptySessionsFile } from '@flutter-ultra/mcp-runtime';

// Read with default fallback
const file = await stateRead(sessionsFilePath(), emptySessionsFile(), SessionsFileSchema);

// Lock-guarded mutation
await stateUpdate(sessionsFilePath(), emptySessionsFile(), SessionsFileSchema, (current) => ({
  ...current,
  sessions: [...current.sessions, newSession],
}));
```

For continuous streams (log tails):

```ts
import { appendJsonl, readJsonl, streamFilePath } from '@flutter-ultra/state-store';

await appendJsonl(
  streamFilePath('s1'),
  { ts: Date.now(), level: 'info', msg: '…' },
  { maxLines: 10_000 },
);

// Reader polls with a cursor
const { entries, cursor } = await readJsonl(streamFilePath('s1'), (raw) => raw, /*afterCursor*/ 0);
```

## License

Apache-2.0. See [LICENSE](../../LICENSE).
