// @flutter-ultra/flutter-ultra-runtime — MCP server entrypoint.
//
// Wires the shared mcp-runtime scaffolding to the runtime tool catalogue
// (28 tools across lifecycle + inspect + logs/http). Plan §5.2 + §17.

import { createServer } from '@flutter-ultra/mcp-runtime';
import { DeviceRouter } from '@flutter-ultra/device-router';
import { createHttpCaptureService } from './httpCapture.js';
import { createLaunchService } from './launchApp.js';
import { createSessionRegistry } from './sessions.js';
import { registerDesignAuditTools } from './tools/designAudit.js';
import { registerDeviceTools } from './tools/devices.js';
import { registerEditorTools } from './tools/editor.js';
import { registerInspectTools } from './tools/inspect.js';
import { registerLifecycleTools } from './tools/lifecycle.js';
import { registerLogsAndHttpTools } from './tools/logsAndHttp.js';
import { registerPerformanceTools } from './tools/performance.js';
import { killProcessTreeVerified, PreviousTreeNotConfirmedDeadError } from './processTree.js';

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

  const deviceRouter = new DeviceRouter();
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
        ...(payload.pidStartKey !== undefined ? { pidStartKey: payload.pidStartKey } : {}),
      });
      return session.id;
    },
    // hac#545: never hold two `flutter run` trees for one project+device.
    findLiveSessionForTarget: (projectDir, device) =>
      sessions.findActiveByTarget(projectDir, device),
    stopLiveSession: async (session) => {
      if (session.pid !== undefined) {
        // hac#545: `session.pid` can be from a PREVIOUS MCP server process
        // (a new sitting restarts the server) — there is no stdin handle
        // to that old process to ask Flutter's own daemon to quit
        // gracefully (that channel only exists in-process; see
        // launchApp.ts's `stop()`, which tries 'q' on stdin first for a
        // launch this SAME process is still tracking). On Windows,
        // `session.pid` is cmd.exe's PID (launchApp.ts spawns with
        // `shell: true`), not the real Flutter tool's — a bare
        // `process.kill(pid)` never cascades to its descendants
        // (`frontend_server`, the Dart VM) on ANY platform, which is
        // exactly how hac#545 recurred. `killProcessTreeVerified` snapshots
        // the WHOLE tree atomically before killing anything (killing the
        // root first would orphan its children — and on POSIX an orphan
        // gets reparented, changing the very ppid links a later sweep
        // would need), verifies each PID against its recorded start
        // identity before touching it, and kills bottom-up. Never
        // `taskkill /T`, never by image name.
        //
        // `killProcessTreeVerified` itself always makes a best-effort
        // kill of the root PID even when the process-table LISTING fails
        // (no `pwsh`/`powershell.exe`, or a timeout) — but reports
        // `confident: false` then, since descendants may be unaccounted
        // for. This specific caller cannot tolerate that: `start()`'s
        // dedup supersede must never spawn a SECOND tree while the first
        // might still be alive (hac#545's exact symptom). A transient
        // listing blip often clears on a second attempt; retry once, and
        // if it's STILL not confident, refuse rather than pretend success
        // — `start()` treats this specific error as a hard stop, not a
        // warn-and-proceed.
        let result = await killProcessTreeVerified(session.pid, session.pidStartKey);
        if (!result.confident) {
          result = await killProcessTreeVerified(session.pid, session.pidStartKey);
        }
        if (!result.confident) {
          throw new PreviousTreeNotConfirmedDeadError(
            session.pid,
            'process-table listing failed twice in a row',
          );
        }
      }
      try {
        await sessions.detach(
          session.id,
          'launch_app: superseded by a new launch for the same project+device',
        );
      } catch {
        // Already terminated — nothing left to do.
      }
    },
  });

  registerDeviceTools({ server, router: deviceRouter });
  registerLifecycleTools({ server, sessions, launch });
  registerEditorTools({ server });
  registerInspectTools({ server, sessions });
  registerLogsAndHttpTools({ server, sessions, http: httpCapture });
  registerPerformanceTools({ server, sessions });
  registerDesignAuditTools({ server, sessions });

  return {
    server,
    sessions,
    launch,
    httpCapture,
    deviceRouter,
    async start() {
      await server.start();
    },
    async stop() {
      await deviceRouter.closeAll();
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
export { freePort, findListenersOnPort, killPid } from './portCleanup.js';
