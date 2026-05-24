// Performance monitoring tools: memory, CPU profiles, frame timing, rebuild
// tracking, startup timing.
//
// All VM Service RPC tools (memory, CPU, timeline) require a Dart VM Service
// WebSocket connection and are NOT supported on web targets. Web perf tools
// live in flutter-ultra-browser.

import type { VmServiceClient, JsonValue } from '@flutter-ultra/vm-service-client';
import { z } from 'zod';
import {
  InvalidToolInputError,
  SessionIdSchema,
  type FlutterUltraServer,
} from '@flutter-ultra/mcp-runtime';
import type { SessionRegistry } from '../sessions.js';

export function registerPerformanceTools(opts: {
  server: FlutterUltraServer;
  sessions: SessionRegistry;
}): void {
  const { server, sessions } = opts;

  async function resolveIsolate(sessionId: string): Promise<{
    isolateId: string;
    client: VmServiceClient;
    release: () => Promise<void>;
  }> {
    const { client, release } = await sessions.acquireClient(sessionId);
    try {
      const vm = await client.getVM();
      const isolateId = vm.isolates[0]?.id;
      if (!isolateId) {
        await release();
        throw new InvalidToolInputError('Session has no isolates.');
      }
      return { isolateId, client, release };
    } catch (err) {
      await release();
      throw err;
    }
  }

  // ── Memory ─────────────────────────────────────────────────────────────────

  server.defineTool(
    {
      name: 'get_memory_usage',
      description:
        'Return heap and process memory usage via VM Service getMemoryUsage + getProcessMemoryUsage. Not supported on web targets (use flutter-ultra-browser web perf tools instead).',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const [isolateMem, processMem] = await Promise.all([
          client.callServiceExtension('getMemoryUsage', { isolateId }),
          client.callServiceExtension('getProcessMemoryUsage'),
        ]);
        return { isolate: isolateMem, process: processMem };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'get_allocation_profile',
      description:
        'Return per-class allocation statistics via VM Service getAllocationProfile. Optionally trigger GC first or reset accumulators.',
      inputShape: {
        sessionId: SessionIdSchema,
        gc: z.boolean().default(false).describe('Run garbage collection before sampling.'),
        reset: z.boolean().default(false).describe('Reset accumulator counts after sampling.'),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const raw = (await client.callServiceExtension('getAllocationProfile', {
          isolateId,
          args: {
            gc: String(args.gc),
            reset: String(args.reset),
          },
        })) as Record<string, unknown>;

        const members = Array.isArray(raw['members'])
          ? (raw['members'] as unknown[]).map((m) => {
              const cls = m as Record<string, unknown>;
              return {
                className:
                  (cls['class'] as Record<string, unknown> | undefined)?.['name'] ??
                  cls['name'] ??
                  '<unknown>',
                instancesCurrent: cls['instancesCurrent'] ?? 0,
                instancesAccumulated: cls['instancesAccumulated'] ?? 0,
                bytesCurrent: cls['bytesCurrent'] ?? 0,
                bytesAccumulated: cls['bytesAccumulated'] ?? 0,
              };
            })
          : [];

        return {
          members,
          dateLastServiceGC: raw['dateLastServiceGC'] ?? null,
        };
      } finally {
        await release();
      }
    },
  );

  // ── CPU profiling ─────────────────────────────────────────────────────────

  server.defineTool(
    {
      name: 'start_cpu_profile',
      description:
        'Enable CPU profiling by setting VM timeline flags to capture Dart samples. Call get_cpu_samples to read the profile, stop_cpu_profile to disable.',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const { client, release } = await sessions.acquireClient(args.sessionId);
      try {
        await client.callServiceExtension('setVMTimelineFlags', {
          args: { recordedStreams: 'Dart' },
        });
        return { started: true, message: 'CPU profiling enabled via Dart timeline stream.' };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'get_cpu_samples',
      description:
        'Retrieve CPU samples collected since start_cpu_profile. Returns per-function tick counts. Not supported on web targets.',
      inputShape: {
        sessionId: SessionIdSchema,
        timeOriginMicros: z.number().int().nonnegative().optional(),
        timeExtentMicros: z.number().int().positive().optional(),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const extraArgs: Record<string, unknown> = {};
        if (args.timeOriginMicros !== undefined)
          extraArgs['timeOriginMicros'] = String(args.timeOriginMicros);
        if (args.timeExtentMicros !== undefined)
          extraArgs['timeExtentMicros'] = String(args.timeExtentMicros);

        const raw = (await client.callServiceExtension('getCpuSamples', {
          isolateId,
          args: extraArgs as Record<string, JsonValue>,
        })) as Record<string, unknown>;

        const functions = Array.isArray(raw['functions'])
          ? (raw['functions'] as unknown[]).map((f) => {
              const fn = f as Record<string, unknown>;
              const func = fn['function'] as Record<string, unknown> | undefined;
              return {
                name: func?.['name'] ?? fn['name'] ?? '<unknown>',
                resolvedUrl:
                  func?.['location'] !== undefined
                    ? ((func['location'] as Record<string, unknown>)['script'] ?? null)
                    : null,
                exclusiveTicks: fn['exclusiveTicks'] ?? 0,
                inclusiveTicks: fn['inclusiveTicks'] ?? 0,
              };
            })
          : [];

        return {
          sampleCount: raw['sampleCount'] ?? 0,
          samplePeriod: raw['samplePeriod'] ?? 0,
          maxStackDepth: raw['maxStackDepth'] ?? 0,
          functions,
        };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'stop_cpu_profile',
      description: 'Disable CPU profiling by clearing VM timeline flags.',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const { client, release } = await sessions.acquireClient(args.sessionId);
      try {
        await client.callServiceExtension('setVMTimelineFlags', {
          args: { recordedStreams: '' },
        });
        return { stopped: true };
      } finally {
        await release();
      }
    },
  );

  // ── Frame timing ──────────────────────────────────────────────────────────

  server.defineTool(
    {
      name: 'start_frame_tracking',
      description:
        'Enable frame timing by recording Embedder and Dart VM timeline streams. Optionally enable profileRenderObjectPaints and profileRenderObjectLayouts Flutter extensions.',
      inputShape: {
        sessionId: SessionIdSchema,
        profilePaints: z.boolean().default(false),
        profileLayouts: z.boolean().default(false),
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        await client.callServiceExtension('setVMTimelineFlags', {
          args: { recordedStreams: 'Embedder,Dart' },
        });

        if (args.profilePaints) {
          try {
            await client.callServiceExtension('ext.flutter.profileRenderObjectPaints', {
              isolateId,
              args: { enabled: 'true' },
            });
          } catch {
            // extension may not exist on all Flutter versions
          }
        }

        if (args.profileLayouts) {
          try {
            await client.callServiceExtension('ext.flutter.profileRenderObjectLayouts', {
              isolateId,
              args: { enabled: 'true' },
            });
          } catch {
            // extension may not exist on all Flutter versions
          }
        }

        return {
          started: true,
          streams: 'Embedder,Dart',
          profilePaints: args.profilePaints,
          profileLayouts: args.profileLayouts,
        };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'get_frame_timing',
      description:
        'Parse frame build/raster timing from the VM timeline. Returns per-frame ms, FPS estimate, jank count, and p50/p95/p99 percentiles. Requires start_frame_tracking to have been called first.',
      inputShape: {
        sessionId: SessionIdSchema,
        timeOriginMicros: z.number().int().nonnegative().optional(),
        timeExtentMicros: z.number().int().positive().optional(),
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { client, release } = await sessions.acquireClient(args.sessionId);
      try {
        const extraArgs: Record<string, unknown> = {};
        if (args.timeOriginMicros !== undefined)
          extraArgs['timeOriginMicros'] = String(args.timeOriginMicros);
        if (args.timeExtentMicros !== undefined)
          extraArgs['timeExtentMicros'] = String(args.timeExtentMicros);

        const raw = (await client.callServiceExtension('getVMTimeline', {
          args: extraArgs as Record<string, JsonValue>,
        })) as Record<string, unknown>;

        const traceEvents = Array.isArray(raw['traceEvents'])
          ? (raw['traceEvents'] as unknown[])
          : [];
        const frames = parseFrameTimings(traceEvents);
        const stats = computeFrameStats(frames);

        return { frames, ...stats };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'stop_frame_tracking',
      description:
        'Disable frame tracking timeline streams and return a timing summary. Combines get_frame_timing result with stopped: true.',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const { client, release } = await sessions.acquireClient(args.sessionId);
      try {
        const raw = (await client.callServiceExtension('getVMTimeline')) as Record<string, unknown>;

        await client.callServiceExtension('setVMTimelineFlags', {
          args: { recordedStreams: '' },
        });

        const traceEvents = Array.isArray(raw['traceEvents'])
          ? (raw['traceEvents'] as unknown[])
          : [];
        const frames = parseFrameTimings(traceEvents);
        const stats = computeFrameStats(frames);

        return { frames, ...stats, stopped: true };
      } finally {
        await release();
      }
    },
  );

  // ── Widget rebuild tracking ───────────────────────────────────────────────

  server.defineTool(
    {
      name: 'start_rebuild_tracking',
      description:
        'Enable widget rebuild dirty tracking via ext.flutter.inspector.trackRebuildDirtyWidgets.',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const result = await client.callServiceExtension(
          'ext.flutter.inspector.trackRebuildDirtyWidgets',
          { isolateId, args: { enabled: 'true' } },
        );
        return { started: true, result };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'get_rebuild_stats',
      description:
        'Read current widget rebuild counts from ext.flutter.inspector.trackRebuildDirtyWidgets.',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const result = await client.callServiceExtension(
          'ext.flutter.inspector.trackRebuildDirtyWidgets',
          { isolateId },
        );
        return { stats: result };
      } finally {
        await release();
      }
    },
  );

  server.defineTool(
    {
      name: 'stop_rebuild_tracking',
      description: 'Disable widget rebuild tracking.',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'quick',
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const result = await client.callServiceExtension(
          'ext.flutter.inspector.trackRebuildDirtyWidgets',
          { isolateId, args: { enabled: 'false' } },
        );
        return { stopped: true, result };
      } finally {
        await release();
      }
    },
  );

  // ── Startup timing ────────────────────────────────────────────────────────

  server.defineTool(
    {
      name: 'get_startup_timing',
      description:
        'Read Flutter startup timing milestones: first frame event and first frame rasterized event via ext.flutter service extensions.',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'quick',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const [firstFrame, firstFrameRasterized] = await Promise.allSettled([
          client.callServiceExtension('ext.flutter.didSendFirstFrameEvent', { isolateId }),
          client.callServiceExtension('ext.flutter.didSendFirstFrameRasterizedEvent', {
            isolateId,
          }),
        ]);

        return {
          firstFrameEvent:
            firstFrame.status === 'fulfilled'
              ? firstFrame.value
              : { error: String((firstFrame as PromiseRejectedResult).reason) },
          firstFrameRasterizedEvent:
            firstFrameRasterized.status === 'fulfilled'
              ? firstFrameRasterized.value
              : { error: String((firstFrameRasterized as PromiseRejectedResult).reason) },
        };
      } finally {
        await release();
      }
    },
  );
}

// ── Frame timing helpers ────────────────────────────────────────────────────

interface FrameTiming {
  buildMs: number;
  rasterMs: number;
  totalMs: number;
  janky: boolean;
}

interface FrameStats {
  fps: number;
  jankCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function parseFrameTimings(traceEvents: unknown[]): FrameTiming[] {
  // Flutter emits paired "Flutter.Frame" Begin/End events in the Embedder stream.
  // We look for name === 'Frame' or name === 'Flutter.Frame' and ph === 'X' (complete)
  // or reconstruct from B/E pairs. The most common shape is ph='X' with 'dur' in us.
  const frames: FrameTiming[] = [];

  for (const ev of traceEvents) {
    const e = ev as Record<string, unknown>;
    const name = e['name'] as string | undefined;
    const ph = e['ph'] as string | undefined;

    if (!name || !(name === 'Frame' || name === 'Flutter.Frame' || name.includes('VSYNC')))
      continue;

    if (ph === 'X') {
      const dur = Number(e['dur'] ?? 0) / 1000; // microseconds → ms
      if (dur <= 0) continue;
      const args = e['args'] as Record<string, unknown> | undefined;
      const buildMs = Number(args?.['Build'] ?? 0) / 1000 || dur * 0.6;
      const rasterMs = Number(args?.['Raster'] ?? 0) / 1000 || dur * 0.4;
      frames.push({
        buildMs: Math.round(buildMs * 100) / 100,
        rasterMs: Math.round(rasterMs * 100) / 100,
        totalMs: Math.round(dur * 100) / 100,
        janky: dur > 16.67,
      });
    }
  }

  return frames;
}

function computeFrameStats(frames: FrameTiming[]): FrameStats {
  if (frames.length === 0) {
    return { fps: 0, jankCount: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  }

  const totals = frames.map((f) => f.totalMs).sort((a, b) => a - b);
  const jankCount = frames.filter((f) => f.janky).length;
  const meanMs = totals.reduce((s, v) => s + v, 0) / totals.length;
  const fps = meanMs > 0 ? Math.round((1000 / meanMs) * 10) / 10 : 0;

  const pct = (p: number) => totals[Math.floor((totals.length - 1) * p)] ?? 0;

  return {
    fps,
    jankCount,
    p50Ms: Math.round(pct(0.5) * 100) / 100,
    p95Ms: Math.round(pct(0.95) * 100) / 100,
    p99Ms: Math.round(pct(0.99) * 100) / 100,
  };
}
