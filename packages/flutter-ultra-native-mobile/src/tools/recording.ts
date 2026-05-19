// Device screen recording tools: start_device_recording / stop_device_recording.
//
// Mirrors the start/stop lifecycle of start_device_logs / stop_device_logs.
// Android: `adb shell screenrecord` (3-minute max, SIGTERM to stop).
// iOS sim: `xcrun simctl io <udid> recordVideo <path>` (SIGTERM to stop).

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { startDeviceRecordingSchema, stopDeviceRecordingSchema } from '../schemas.js';

interface RecordingSession {
  recordingId: string;
  deviceId: string;
  outputPath: string;
  remotePath?: string; // Android: /sdcard/recording-<id>.mp4
  startedAt: number;
  child: ChildProcess;
  device: AndroidDevice | IosSimDevice;
}

// Module-level registry of active recording sessions.
const sessions = new Map<string, RecordingSession>();

export function registerRecordingTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'start_device_recording',
      description:
        'Begin a screen recording on a device. Android: adb screenrecord (max 180s). iOS sim: simctl recordVideo. Returns a recordingId to pass to stop_device_recording.',
      inputShape: startDeviceRecordingSchema.shape,
      timeoutClass: 'quick',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);

      if (!(device instanceof AndroidDevice) && !(device instanceof IosSimDevice)) {
        throw new InvalidToolInputError(
          `start_device_recording: unsupported device kind '${device.kind}'. Android and iOS Simulator supported.`,
        );
      }

      const recordingId = randomUUID();
      let child: ChildProcess;
      let remotePath: string | undefined;

      await mkdir(dirname(args.outputPath), { recursive: true });

      if (device instanceof AndroidDevice) {
        // Android screenrecord writes to device storage; we pull after stop.
        remotePath = `/sdcard/recording-${recordingId}.mp4`;
        const argv = [
          device.adbCli,
          '-s',
          device.id,
          'shell',
          'screenrecord',
          '--time-limit',
          String(args.maxDurationSec),
          remotePath,
        ];
        child = spawn(argv[0]!, argv.slice(1), {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } else {
        // iOS sim: xcrun simctl io <udid> recordVideo <outputPath>
        const argv = ['xcrun', 'simctl', 'io', device.id, 'recordVideo', args.outputPath];
        child = spawn(argv[0]!, argv.slice(1), {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      }

      const session: RecordingSession = {
        recordingId,
        deviceId: args.deviceId,
        outputPath: args.outputPath,
        ...(remotePath !== undefined ? { remotePath } : {}),
        startedAt: Date.now(),
        child,
        device,
      };
      sessions.set(recordingId, session);

      child.on('close', () => {
        // Keep the session alive so stop_device_recording can pull the file.
        // stop_device_recording deletes the session after pulling.
      });

      return {
        recordingId,
        deviceId: args.deviceId,
        outputPath: args.outputPath,
        startedAt: new Date(session.startedAt).toISOString(),
        platform: device instanceof AndroidDevice ? 'android' : 'ios-sim',
      };
    },
  );

  server.defineTool(
    {
      name: 'stop_device_recording',
      description:
        'Stop a device screen recording. Sends SIGINT to the recording process. On Android, pulls the video from device storage to the outputPath. Returns the local file path and duration.',
      inputShape: stopDeviceRecordingSchema.shape,
      timeoutClass: 'long',
    },
    async (args) => {
      const session = sessions.get(args.recordingId);
      if (!session) {
        throw new InvalidToolInputError(
          `stop_device_recording: recordingId '${args.recordingId}' not found. Was it already stopped or never started?`,
        );
      }

      const durationMs = Date.now() - session.startedAt;

      // Send SIGINT (graceful stop) so screenrecord/simctl flushes the file.
      try {
        session.child.kill('SIGINT');
      } catch {
        // already exited
      }

      // Wait briefly for the process to exit and flush.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3_000);
        session.child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      // Android: pull file from device storage.
      if (session.device instanceof AndroidDevice && session.remotePath) {
        await session.device.download(session.remotePath, session.outputPath);
        // Best-effort cleanup of the device-side file.
        await session.device
          .shell(['rm', '-f', session.remotePath], { timeoutMs: 5_000 })
          .catch(() => undefined);
      }

      sessions.delete(args.recordingId);

      return {
        recordingId: args.recordingId,
        path: session.outputPath,
        durationMs,
      };
    },
  );
}

/** Stop all active recordings on server shutdown. */
export function shutdownRecordings(): void {
  for (const session of sessions.values()) {
    try {
      session.child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
  sessions.clear();
}
