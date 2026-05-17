// Device-logs split-tool trio: start_device_logs / poll_device_logs /
// stop_device_logs. Mirrors flutter-ultra-runtime/tail_logs shape.

import type { FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import { InvalidToolInputError } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import type { LogStreamService } from '../logStream.js';
import { pollDeviceLogsSchema, startDeviceLogsSchema, stopDeviceLogsSchema } from '../schemas.js';

export function registerLogTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
  logStream: LogStreamService;
}): void {
  const { server, registry, logStream } = opts;

  server.defineTool(
    {
      name: 'start_device_logs',
      description:
        'Begin tailing device logs (Android logcat / iOS sim log stream). Returns a streamId to poll with poll_device_logs. Buffer is capped at bufferLines (default 1000, oldest dropped when full).',
      inputShape: startDeviceLogsSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      const stream = await logStream.start({
        device,
        ...(args.tagFilters !== undefined ? { tagFilters: args.tagFilters } : {}),
        ...(args.grep !== undefined ? { grep: args.grep } : {}),
        ...(args.bufferLines !== undefined ? { bufferLines: args.bufferLines } : {}),
      });
      return {
        streamId: stream.streamId,
        deviceId: stream.deviceId,
        bufferLines: stream.bufferLines,
        startedAt: stream.startedAt,
      };
    },
  );

  server.defineTool(
    {
      name: 'poll_device_logs',
      description:
        'Cursor-paginated read of buffered device log lines. Pass afterCursor=0 on first call; pass the returned cursor next time.',
      inputShape: pollDeviceLogsSchema.shape,
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true },
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      if (!logStream.has(args.streamId)) {
        throw new InvalidToolInputError(
          `poll_device_logs: streamId '${args.streamId}' not found. Was the stream stopped or never started?`,
        );
      }
      return logStream.poll({
        streamId: args.streamId,
        afterCursor: args.afterCursor,
        maxLines: args.maxLines,
      });
    },
  );

  server.defineTool(
    {
      name: 'stop_device_logs',
      description: 'Stop a device-log stream and release the underlying child process.',
      inputShape: stopDeviceLogsSchema.shape,
      timeoutClass: 'quick',
    },
    async (args) => {
      logStream.stop(args.streamId);
      return { stopped: args.streamId };
    },
  );
}
