// E2E: the build server's start_* job tools must spawn the Flutter CLI as a
// real background job. On Windows the CLI resolves to flutter.bat, and Node
// >=20.12.2 throws a synchronous `spawn EINVAL` for .bat/.cmd unless the job
// runner passes a shell (CVE-2024-27980 hardening) — a class that in-process
// tests and launch-only E2E never exercise.
//
// Requires a Flutter SDK on PATH and `flutter pub get` in examples/counter-app
// (both guaranteed by the ci-e2e-windows workflow).

import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnMcpClient, type McpClient } from './mcp-client.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const COUNTER_APP = join(ROOT, 'examples', 'counter-app');
const BUILD_BIN = join(ROOT, 'packages', 'flutter-ultra-build', 'dist', 'bin.cjs');

const flutterOnPath =
  spawnSync(process.platform === 'win32' ? 'where' : 'which', ['flutter'], {
    encoding: 'utf8',
    windowsHide: true,
  }).status === 0;

interface StartResult {
  jobId?: string;
  status?: string;
}

interface PollResult {
  status?: string;
  errorSummary?: string;
  stdoutTail?: string;
}

describe.skipIf(!flutterOnPath)('build server start_* jobs (real flutter spawn)', () => {
  let client: McpClient | undefined;

  afterEach(() => {
    client?.close();
    client = undefined;
  });

  it(
    'start_run_unit_tests runs the counter-app suite to completion',
    { timeout: 300_000 },
    async () => {
      client = spawnMcpClient(BUILD_BIN, ROOT);
      await client.initialize();

      // Pre-fix this call itself errored with a synchronous `spawn EINVAL`.
      const started = (await client.callTool('start_run_unit_tests', {
        root: COUNTER_APP,
      })) as StartResult;
      expect(started.jobId).toBeTruthy();

      let last: PollResult = {};
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        last = (await client.callTool('poll_run_unit_tests', {
          jobId: started.jobId,
        })) as PollResult;
        if (last.status !== 'pending' && last.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 2000));
      }

      expect(
        last.status,
        `job ended ${last.status}: ${last.errorSummary ?? ''}\n${last.stdoutTail ?? ''}`,
      ).toBe('completed');
    },
  );
});
