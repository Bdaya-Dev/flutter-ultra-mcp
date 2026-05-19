// Lifecycle tools: discover/attach/detach/list/launch/poll/stop, hot reload + restart.

import { z } from 'zod';
import {
  InvalidToolInputError,
  SessionIdSchema,
  SessionTerminatedError,
  type FlutterUltraServer,
} from '@flutter-ultra/mcp-runtime';
import { discover } from '../discovery.js';
import type { LaunchService } from '../launchApp.js';
import type { SessionRegistry } from '../sessions.js';

export function registerLifecycleTools(opts: {
  server: FlutterUltraServer;
  sessions: SessionRegistry;
  launch: LaunchService;
}): void {
  const { server, sessions, launch } = opts;

  const BUILD_TS = '2026-05-19T03:30:00Z';
  const BUILD_ID = 'f8bb09b-stdin-proxy';

  server.defineTool(
    {
      name: 'runtime_version',
      description: 'Returns the build timestamp and ID of the running runtime server bundle. Use to verify which version Claude Code loaded.',
      timeoutClass: 'instant',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => ({
      buildTimestamp: BUILD_TS,
      buildId: BUILD_ID,
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      toolCount: 43,
    }),
  );

  server.defineTool(
    {
      name: 'discover_sessions',
      description:
        "Scan running processes for live `flutter run` debug sessions. Uses the 8-strategy ladder from worker-P's discovery report (process scan + raw VM port redirect trick on Windows). Returns unattached candidates the agent can then `attach` to.",
      timeoutClass: 'instant',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (_args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const found = await discover({ logger: server.logger });
      return { count: found.length, candidates: found };
    },
  );

  server.defineTool(
    {
      name: 'attach',
      description:
        "Attach to a Flutter VM service URI. Returns a sessionId you pass to every other runtime tool. Set clientName to flutter-ultra/runtime/<pid> so DDS multi-client coexistence with VS Code's Dart debugger is clean.",
      inputShape: {
        uri: z
          .string()
          .min(6)
          .describe(
            'Full WebSocket URI: ws://127.0.0.1:<dds-port>/<token>=/ws (or a raw VM http:// URI; we auto-resolve DDS redirect).',
          ),
        projectRoot: z.string().optional(),
        device: z.string().optional(),
        appName: z.string().optional(),
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      let uri = args.uri;
      let rawVmUri: string | undefined;
      if (!/^wss?:\/\//.test(uri)) {
        // Allow http:// raw VM URLs; convert + probe DDS redirect first.
        const found = await discover({ logger: server.logger });
        const match = found.find((s) => s.rawVmUri === args.uri || s.uri === args.uri);
        if (match) {
          uri = match.uri;
          if (match.rawVmUri !== undefined) rawVmUri = match.rawVmUri;
        } else {
          throw new InvalidToolInputError(
            'attach expects a ws:// URI. Pass the DDS WS URI shown by `discover_sessions` or by `flutter run --machine` `app.started` event.',
          );
        }
      }
      const session = await sessions.attach({
        uri,
        source: 'manual',
        ...(rawVmUri !== undefined ? { rawVmUri } : {}),
        ...(args.projectRoot !== undefined ? { projectRoot: args.projectRoot } : {}),
        ...(args.device !== undefined ? { device: args.device } : {}),
        ...(args.appName !== undefined ? { appName: args.appName } : {}),
      });
      return { sessionId: session.id, session };
    },
  );

  server.defineTool(
    {
      name: 'detach',
      description:
        "Close a session's WS connection. The Flutter app keeps running; only our attachment ends.",
      inputShape: {
        sessionId: SessionIdSchema,
        reason: z.string().optional(),
      },
      timeoutClass: 'quick',
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      await sessions.detach(args.sessionId, args.reason);
      return { ok: true, sessionId: args.sessionId };
    },
  );

  server.defineTool(
    {
      name: 'list_sessions',
      description: 'List active + recently-terminated sessions with their URIs, status, devices.',
      timeoutClass: 'instant',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const list = await sessions.list();
      return { count: list.length, sessions: list };
    },
  );

  server.defineTool(
    {
      name: 'launch_app',
      description:
        'MARATHON split-tool — spawn `flutter run --machine` and return a jobId. Poll status with `poll_launch_app`. Auto-imports dartDefines + args from .vscode/launch.json when `importLaunchJsonConfig` is set.',
      inputShape: {
        projectDir: z
          .string()
          .describe('Absolute path to the Flutter project root (contains pubspec.yaml).'),
        target: z
          .string()
          .describe(
            'Entrypoint Dart file relative to projectDir (e.g. lib/main_development.dart).',
          ),
        device: z.string().describe('Device id: chrome / windows / android-<id> / ios-<uuid>.'),
        flavor: z.string().optional(),
        dartDefines: z.record(z.string()).optional(),
        webRenderer: z.enum(['canvaskit', 'html', 'auto']).optional(),
        webPort: z.number().int().optional(),
        webHostname: z.string().optional(),
        webBrowserFlags: z.array(z.string()).optional(),
        splitDebugInfo: z.string().optional(),
        pubGetFirst: z.boolean().optional(),
        importLaunchJsonConfig: z
          .string()
          .optional()
          .describe(
            'Name of a configuration in .vscode/launch.json to import dart-defines + args from.',
          ),
        headless: z
          .boolean()
          .optional()
          .describe(
            'Run web targets in headless Chrome. Defaults to true for MCP automation. Set false for headed.',
          ),
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const job = await launch.start({
        projectDir: args.projectDir,
        target: args.target,
        device: args.device,
        ...(args.flavor !== undefined ? { flavor: args.flavor } : {}),
        ...(args.dartDefines !== undefined ? { dartDefines: args.dartDefines } : {}),
        ...(args.webRenderer !== undefined ? { webRenderer: args.webRenderer } : {}),
        ...(args.webPort !== undefined ? { webPort: args.webPort } : {}),
        ...(args.webHostname !== undefined ? { webHostname: args.webHostname } : {}),
        ...(args.webBrowserFlags !== undefined ? { webBrowserFlags: args.webBrowserFlags } : {}),
        ...(args.splitDebugInfo !== undefined ? { splitDebugInfo: args.splitDebugInfo } : {}),
        ...(args.pubGetFirst !== undefined ? { pubGetFirst: args.pubGetFirst } : {}),
        ...(args.importLaunchJsonConfig !== undefined
          ? { importLaunchJsonConfig: args.importLaunchJsonConfig }
          : {}),
        ...(args.headless !== undefined ? { headless: args.headless } : {}),
      });
      return { jobId: job.jobId, stage: job.stage };
    },
  );

  server.defineTool(
    {
      name: 'poll_launch_app',
      description:
        'Poll a `launch_app` job. Returns stage (pending/compiling/installing/booting/attached/failed/stopped), sessionId once attached, and the last ~200 log lines.',
      inputShape: {
        jobId: z.string().min(8),
      },
      timeoutClass: 'instant',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const job = await launch.poll(args.jobId);
      return { job };
    },
  );

  server.defineTool(
    {
      name: 'stop_app',
      description:
        'Stop an app spawned via `launch_app`. Cascade: machine-mode `q` on stdin → 2s grace → SIGTERM → 5s → SIGKILL. Also detaches the bound session.',
      inputShape: {
        jobId: z.string().min(8),
        force: z.boolean().default(false),
      },
      timeoutClass: 'quick',
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      const finalJob = await launch.stop(args.jobId, { force: args.force });
      if (finalJob.sessionId) {
        try {
          await sessions.detach(finalJob.sessionId, 'stop_app');
        } catch {
          /* may already be terminated */
        }
      }
      return { job: finalJob };
    },
  );

  server.defineTool(
    {
      name: 'call_service_extension',
      description:
        'Invoke a VM service extension via the daemon stdin protocol. Works on ALL platforms including web (no second WebSocket needed). Use for widget inspection, performance overlays, or any `ext.flutter.*` / `ext.dwds.*` call.',
      inputShape: {
        jobId: z.string().min(8).describe('Job ID from launch_app.'),
        methodName: z
          .string()
          .describe(
            'Service extension method, e.g. ext.flutter.inspector.getRootWidgetSummaryTree',
          ),
        params: z.record(z.string(), z.any()).optional().describe('Optional params map for the extension.'),
      },
      timeoutClass: 'long',
      ceilingMs: 60_000,
    },
    async (args) => {
      const result = await launch.callServiceExtension(
        args.jobId,
        args.methodName,
        args.params as Record<string, unknown> | undefined,
      );
      return { ok: true, result };
    },
  );

  server.defineTool(
    {
      name: 'daemon_restart',
      description:
        'Hot reload or hot restart via the daemon stdin protocol. Equivalent to pressing r/R in the terminal. Works on all platforms including web.',
      inputShape: {
        jobId: z.string().min(8).describe('Job ID from launch_app.'),
        fullRestart: z
          .boolean()
          .default(false)
          .describe('true = hot restart (loses state), false = hot reload (preserves state).'),
      },
      timeoutClass: 'long',
      ceilingMs: 90_000,
    },
    async (args) => {
      const result = await launch.restart(args.jobId, { fullRestart: args.fullRestart });
      return { ok: true, result };
    },
  );

  server.defineTool(
    {
      name: 'hot_reload',
      description:
        "Trigger reloadSources on the session's main isolate. AC-R1: completes within 5s; subsequent `get_widget_tree` reflects the reload without re-attach.",
      inputShape: { sessionId: SessionIdSchema },
      timeoutClass: 'quick',
      ceilingMs: 60_000,
    },
    async (args, { signal }) => {
      const { client, release } = await sessions.acquireClient(args.sessionId);
      try {
        const vm = await client.getVM();
        const isolateId = vm.isolates[0]?.id;
        if (!isolateId)
          throw new InvalidToolInputError('Session has no isolates; cannot hot reload.');
        if (signal.aborted) throw signal.reason as Error;
        const result = await client.callServiceExtension('reloadSources', {
          isolateId,
          args: { force: false, pause: false },
        });
        return { ok: true, isolateId, result };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'hot_restart',
      description:
        'Trigger a full hot restart via `s0.reloadSources` with `force: true` + isolate-restart fallback when DDS surfaces it.',
      inputShape: { sessionId: SessionIdSchema },
      timeoutClass: 'long',
      ceilingMs: 90_000,
    },
    async (args, { signal, sendProgress }) => {
      const { client, release } = await sessions.acquireClient(args.sessionId);
      try {
        sendProgress({ progress: 0.1, message: 'Resolving isolate' });
        const vm = await client.getVM();
        const isolateId = vm.isolates[0]?.id;
        if (!isolateId)
          throw new InvalidToolInputError('Session has no isolates; cannot hot restart.');
        if (signal.aborted) throw signal.reason as Error;
        sendProgress({ progress: 0.5, message: 'reloadSources --force' });
        // The "real" hot-restart RPC name is `s0.reloadSources` in some
        // Flutter versions and `hotRestart` in others; fall back gracefully.
        let result: unknown;
        try {
          result = await client.callServiceExtension('s0.reloadSources', {
            isolateId,
            args: { force: 'true', pause: 'false' },
          });
        } catch {
          result = await client.callServiceExtension('reloadSources', {
            isolateId,
            args: { force: 'true', pause: 'false' },
          });
        }
        sendProgress({ progress: 1, message: 'Restart complete' });
        return { ok: true, isolateId, result };
      } finally {
        await release();
      }
    },
  );
}

// Helper: surface "session terminated" as a structured error early.
export function assertSessionAlive(_id: string, status: string, reason?: string): void {
  if (status === 'terminated') throw new SessionTerminatedError(_id, reason);
}
