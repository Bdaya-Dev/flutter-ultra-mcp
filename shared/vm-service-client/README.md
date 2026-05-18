# @flutter-ultra/vm-service-client

TypeScript Dart VM Service client with DDS multi-client coordination. Backs the
`flutter-ultra-runtime`, `flutter-ultra-gesture`, `flutter-ultra-devtools`, and
`flutter-ultra-patrol` MCP servers in the [flutter-ultra-mcp](https://github.com/Bdaya-Dev/flutter-ultra-mcp)
plugin.

Ports the subset of [`package:vm_service`](https://pub.dev/packages/vm_service)
those servers actually call (~15 methods) plus the two DDS extensions that make
coexistence with VS Code's Dart debugger safe.

## Install

```bash
npm install @flutter-ultra/vm-service-client
```

## Quick start

```ts
import { VmServiceClient } from '@flutter-ultra/vm-service-client';

const client = new VmServiceClient('ws://127.0.0.1:8181/abc/ws', {
  // DDS multi-client identity. Format recommendation: flutter-ultra/<server>/<pid>
  clientName: `flutter-ultra/runtime/${process.pid}`,
});

await client.connect();

const vm = await client.getVM();
console.log(`pid=${vm.pid} isolates=${vm.isolates.length}`);

await client.streamListen('Logging');
client.on('loggingEvent', (event) => {
  console.log('log:', event);
});

await client.dispose();
```

Connection target also accepts `{host, port, ws_path}`:

```ts
const client = new VmServiceClient({ host: '127.0.0.1', port: 8181, ws_path: 'abc/ws' });
```

## Ported method surface

| Group            | RPCs                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| Inspection       | `getVM`, `getIsolate`, `getObject`, `getFlagList`, `getInstances`, `getStack` |
| Evaluation       | `evaluate`, `evaluateInFrame`, `callServiceExtension`                         |
| Streams          | `streamListen`, `streamCancel`                                                |
| Execution        | `pause`, `resume`, `setLibraryDebuggable`                                     |
| DDS coordination | `setClientName`, `getStreamHistory`                                           |

Plus typed event subscriptions:

- `client.on('isolateEvent' | 'extensionEvent' | 'loggingEvent' | 'stdoutEvent' | 'stderrEvent' | 'vmEvent' | 'debugEvent' | 'serviceEvent' | 'timelineEvent', (event) => …)`
- `for await (const event of client.onIsolateEvent()) { … }` (AsyncIterable)
- Catch-all: `client.on('event', (streamId, event) => …)`

## DDS coexistence (plan §7.2)

The client is designed to share a DDS instance with VS Code's Dart debugger
without conflict. Two rules:

1. Always set `clientName` to something unique-per-process. DDS uses the name
   to identify cooperating clients for resume coordination.
2. **Never** call `requirePermissionToResume(...)` — VS Code's debugger must
   remain the sole resume authority. This client deliberately does NOT expose
   that DDS RPC.

## Polymorphic responses

`evaluate` and `evaluateInFrame` return one of three shapes — narrow on
`result.type`:

```ts
const result = await client.evaluate(isolateId, targetId, 'someExpression');
switch (result.type) {
  case '@Instance':
    console.log('value =', result.valueAsString);
    break;
  case '@Error':
    console.log('eval failed:', result.message);
    break;
  case 'Sentinel':
    console.log('isolate state changed:', result.kind);
    break;
}
```

`getIsolate` / `getObject` throw `SentinelException` instead of returning a
sentinel union, since the caller almost always wants to re-discover and retry
rather than handle the sentinel inline.

## Reconnect

Auto-reconnect is on by default with exponential backoff
(`[500, 1000, 2000, 4000, 8000, 14500] ms`). Tune via:

```ts
new VmServiceClient(uri, {
  autoReconnect: true,
  reconnectDelaysMs: [500, 1_000, 2_000, 5_000],
});
```

Pending in-flight requests reject with `ConnectionDisposedError` on disconnect;
listen for the `disconnect` event on the client (and the `reconnected` event
on `client.transport`) to drive a retry loop in your tool layer.

## Error model

| Class                     | Thrown on                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `RpcError`                | JSON-RPC error response (carries `code`, `message`, optional `data`, originating method name) |
| `SentinelException`       | `getIsolate` / `getObject` got back a `Sentinel` instead of the requested type                |
| `ConnectionDisposedError` | Transport closed before the request completed                                                 |
| `ConnectionTimeoutError`  | WS connect or per-request timeout fired                                                       |

`RpcErrorCode` exports the documented VM service + DDS error codes
(`-32601` `MethodNotFound`, `106` `IsolateMustBePaused`, etc.).

## Strict typing

All response shapes are validated at runtime via Zod (`.strict()` everywhere,
no `z.any()`/`z.record()` in the schema graph), then surfaced as inferred
TypeScript types. Schema drift in the VM service protocol fails loudly rather
than silently corrupting downstream consumers.

## License

Apache-2.0. See [LICENSE](../../LICENSE).
