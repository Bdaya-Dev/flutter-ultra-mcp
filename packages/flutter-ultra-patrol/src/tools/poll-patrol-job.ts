// poll_patrol_job — non-blocking status read for a marathon job.

import { z } from 'zod';
import { defineTool } from './types.js';
import type { JobLogLine } from '../runtime/job-store.js';

export interface TestStep {
  /** Test file path, project-relative. */
  file: string;
  /** Test name, empty if file-level only. */
  test: string;
  /** Current step status. */
  status: 'running' | 'passed' | 'failed';
  /** Epoch ms when the step marker was first seen (from log line ts). */
  startedAt: number;
}

const RUNNING_LINE = /^Running:\s+(\S+)(?:\s+--\s+(.+))?$/;
const PASS_STEP_LINE = /^PASS\s+(\S+?)(?:\s+--\s+(.+?))?(?:\s+\(\d+(?:\.\d+)?s\))?$/;
const FAIL_STEP_LINE = /^FAIL\s+(\S+?)(?:\s+--\s+(.+?))?(?:\s+\(\d+(?:\.\d+)?s\))?$/;

export const pollPatrolJobTool = defineTool({
  name: 'poll_patrol_job',
  description:
    'Return current status, exit code, last log lines, and rolling counters for a marathon Patrol job (started by start_patrol_test or start_patrol_develop). Non-blocking. Pass cursor=logTotal from previous response to receive only new lines and avoid re-processing old output.',
  inputSchema: z.object({
    taskId: z.string().min(1),
    /** Max log lines to return from the tail buffer. */
    logLines: z
      .number()
      .int()
      .min(0)
      .max(500)
      .optional()
      .describe('Max log lines from rolling tail (default 100).'),
    /** When true, drops stderr lines from the returned slice. */
    onlyStdout: z.boolean().optional(),
    /**
     * Cursor for incremental log streaming. Pass the logTotal value from the
     * previous poll response to receive only lines added since then. Omit (or
     * pass 0) to receive the most recent logLines lines as before.
     */
    cursor: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Absolute log-line index of last seen line. Pass logTotal from previous response.'),
  }),
  handler(input, ctx) {
    const job = ctx.jobs.get(input.taskId);
    if (!job) {
      return { found: false, taskId: input.taskId };
    }

    const limit = input.logLines ?? 100;
    const cursor = input.cursor ?? 0;

    // logTotal is the absolute count of all lines ever seen.
    // logTail holds at most logTailLimit lines (default 500).
    // The absolute index of logTail[0] is: logTotal - logTail.length
    const tailStartIdx = job.logTotal - job.logTail.length;
    let sliced: JobLogLine[];

    if (cursor > 0 && cursor >= tailStartIdx) {
      // Cursor is within the retained tail — return only lines after cursor.
      const offsetInTail = cursor - tailStartIdx;
      const newLines = job.logTail.slice(offsetInTail);
      const filtered = filterTail(newLines, input.onlyStdout);
      sliced = filtered.slice(0, limit);
    } else {
      // No cursor or cursor has been evicted from the ring buffer — fall back
      // to returning the most recent `limit` lines.
      const filtered = filterTail(job.logTail, input.onlyStdout);
      sliced = filtered.slice(Math.max(0, filtered.length - limit));
    }

    const steps = extractSteps(job.logTail);

    return {
      found: true,
      taskId: job.id,
      kind: job.kind,
      status: job.status,
      command: job.command,
      args: job.args,
      cwd: job.cwd,
      wrapperScript: job.wrapperScript,
      pid: job.child?.pid ?? null,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      durationMs: (job.endedAt ?? Date.now()) - job.startedAt,
      exitCode: job.exitCode,
      errorMessage: job.errorMessage,
      logTotal: job.logTotal,
      logTail: sliced,
      steps,
    };
  },
});

function filterTail(tail: JobLogLine[], onlyStdout: boolean | undefined): JobLogLine[] {
  if (!onlyStdout) return tail;
  return tail.filter((l) => l.stream === 'stdout');
}

export function extractSteps(logTail: JobLogLine[]): TestStep[] {
  const steps = new Map<string, TestStep>();

  for (const entry of logTail) {
    const line = entry.text;

    const runMatch = line.match(RUNNING_LINE);
    if (runMatch) {
      const file = runMatch[1] ?? '';
      const test = runMatch[2] ?? '';
      const key = `${file}\0${test}`;
      if (!steps.has(key)) {
        steps.set(key, { file, test, status: 'running', startedAt: entry.ts });
      }
      continue;
    }

    const passMatch = line.match(PASS_STEP_LINE);
    if (passMatch) {
      const file = passMatch[1] ?? '';
      const test = passMatch[2] ?? '';
      const key = `${file}\0${test}`;
      const existing = steps.get(key);
      if (existing) {
        existing.status = 'passed';
      } else {
        steps.set(key, { file, test, status: 'passed', startedAt: entry.ts });
      }
      continue;
    }

    const failMatch = line.match(FAIL_STEP_LINE);
    if (failMatch) {
      const file = failMatch[1] ?? '';
      const test = failMatch[2] ?? '';
      const key = `${file}\0${test}`;
      const existing = steps.get(key);
      if (existing) {
        existing.status = 'failed';
      } else {
        steps.set(key, { file, test, status: 'failed', startedAt: entry.ts });
      }
    }
  }

  return Array.from(steps.values());
}
