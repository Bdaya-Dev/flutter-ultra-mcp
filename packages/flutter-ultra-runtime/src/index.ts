// @flutter-ultra/flutter-ultra-runtime — MCP server entrypoint.
//
// Wires the shared mcp-runtime scaffolding to the runtime tool catalogue
// (28 tools across lifecycle + inspect + logs/http). Plan §5.2 + §17.

import { createServer } from '@flutter-ultra/mcp-runtime';
import { createHttpCaptureService } from './httpCapture.js';
import { createLaunchService } from './launchApp.js';
import { createSessionRegistry } from './sessions.js';
import { registerInspectTools } from './tools/inspect.js';
import { registerLifecycleTools } from './tools/lifecycle.js';
import { registerLogsAndHttpTools } from './tools/logsAndHttp.js';

export const SERVER_NAME = 'flutter-ultra-runtime';
export const SERVER_VERSION = '0.0.1';

export interface CreateRuntimeServerOptions {
  // Override the keep-alive interval for tests (defaults to 30s).
  keepAliveIntervalMs?: number;
}

export async function createRuntimeServer(options: CreateRuntimeServerOptions = {}) {
  const server = createServer({
    info: { name: SERVER_NAME, version: SERVER_VERSION },
    ...(options.keepAliveIntervalMs !== undefined
      ? { keepAliveIntervalMs: options.keepAliveIntervalMs }
      : {}),
  });

  const sessions = createSessionRegistry({ serverName: 'runtime', logger: server.logger });
  const httpCapture = createHttpCaptureService({ logger: server.logger });
  const launch = createLaunchService({
    logger: server.logger,
    onSessionReady: async (_jobId, payload) => {
      const session = await sessions.attach({
        uri: payload.uri,
        source: 'launched',
        projectRoot: payload.projectRoot,
        device: payload.device,
        ...(payload.appName !== undefined ? { appName: payload.appName } : {}),
        ...(payload.pid !== undefined ? { pid: payload.pid } : {}),
      });
      return session.id;
    },
  });

  registerLifecycleTools({ server, sessions, launch });
  registerInspectTools({ server, sessions });
  registerLogsAndHttpTools({ server, sessions, http: httpCapture });

  return {
    server,
    sessions,
    launch,
    httpCapture,
    async start() {
      await server.start();
    },
    async stop() {
      await launch.shutdown();
      await sessions.shutdown();
      await httpCapture.shutdown();
      await server.stop();
    },
  };
}

export { createSessionRegistry } from './sessions.js';
export { createLaunchService } from './launchApp.js';
export { createHttpCaptureService } from './httpCapture.js';
export { discover, httpToWs } from './discovery.js';
export { fetchSummaryTree, findInTree, matchesFinder, walkTree } from './widgetTree.js';
