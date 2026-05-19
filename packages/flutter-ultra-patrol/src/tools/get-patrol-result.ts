// get_patrol_result — finalize a completed test job; parse structured
// pass/fail/skipped counts + failure diagnostics.

import { z } from 'zod';
import { defineTool } from './types.js';
import { parseTestResults } from '../util/results-parser.js';
import type { JobLogLine } from '../runtime/job-store.js';

const PORT_LINE = /\[patrol-web-debugger-port\]\s+(\d+)/i;

function detectWebDebuggerPort(logTail: JobLogLine[]): number | null {
  for (const line of logTail) {
    const m = line.text.match(PORT_LINE);
    if (m && m[1]) return Number(m[1]);
  }
  return null;
}

export interface DiagnosticHints {
  /** Hint for capturing a browser screenshot, or null if not applicable. */
  screenshot: string | null;
  /** Hint for dumping the widget tree via the runtime server, or null if not applicable. */
  widgetTree: string | null;
  /** Hint about browser errors captured during the run, or null if none. */
  browserErrors: string | null;
}

function buildDiagnosticHints(
  isWebTest: boolean,
  isHeadless: boolean,
  hasFailures: boolean,
  hasBrowserErrors: boolean,
  debuggerPort: number | null,
): DiagnosticHints {
  if (!hasFailures) {
    return { screenshot: null, widgetTree: null, browserErrors: null };
  }

  let screenshot: string | null = null;
  if (isWebTest) {
    const headlessNote = isHeadless
      ? ' Headless CDP screenshots are available via take_patrol_screenshot.'
      : '';
    screenshot = `Call take_patrol_screenshot to capture the browser state at failure time.${headlessNote}`;
  }

  let widgetTree: string | null = null;
  if (isWebTest && debuggerPort !== null) {
    widgetTree = `Call flutter-ultra-runtime get_widget_tree to capture the widget hierarchy at the point of failure. CDP debugger port: ${debuggerPort}.`;
  } else if (isWebTest) {
    widgetTree =
      'Call flutter-ultra-runtime get_widget_tree to capture the widget hierarchy at the point of failure.';
  }

  const browserErrors: string | null = hasBrowserErrors
    ? 'Browser errors were captured during the run — see browserErrors[] on each failure entry.'
    : null;

  return { screenshot, widgetTree, browserErrors };
}

function buildScreenshotHint(
  isWebTest: boolean,
  isHeadless: boolean,
  hasFailures: boolean,
): { screenshotAvailable: boolean; screenshotHint: string } {
  if (!isWebTest || !hasFailures) {
    return { screenshotAvailable: false, screenshotHint: '' };
  }
  const headlessNote = isHeadless
    ? ' Headless CDP screenshots are available via take_patrol_screenshot.'
    : '';
  return {
    screenshotAvailable: true,
    screenshotHint: `Call take_patrol_screenshot to capture the browser state at failure time.${headlessNote}`,
  };
}

export const getPatrolResultTool = defineTool({
  name: 'get_patrol_result',
  description:
    'Return the final structured result for a completed patrol test job: {passed, failed, skipped, durations, failures: [{test, error, stackTrace, lastScreenshot, browserErrors[]}]}. Returns {ready:false} if the job is still running.',
  inputSchema: z.object({
    taskId: z.string().min(1),
  }),
  handler(input, ctx) {
    const job = ctx.jobs.get(input.taskId);
    if (!job) return { found: false, taskId: input.taskId };
    const terminal =
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'crashed';
    if (!terminal) {
      return {
        found: true,
        ready: false,
        taskId: job.id,
        status: job.status,
      };
    }
    const durationMs = (job.endedAt ?? ctx.now()) - job.startedAt;
    const result = parseTestResults(job.logTail, durationMs);

    const totalLogLines = job.logTotal;
    const logTailTruncated = job.logTotal > job.logTail.length;

    const isWebTest = 'PATROL_WEB_BROWSER_ARGS' in job.envSnapshot;
    const isHeadless = job.args.includes('--web-headless');
    const debuggerPort = isWebTest ? detectWebDebuggerPort(job.logTail) : null;

    const crashed = job.status === 'crashed' || job.status === 'failed';
    const noTestsRan = result.passed + result.failed + result.skipped === 0;
    if (crashed && noTestsRan) {
      const stderrLines = job.logTail
        .filter((l) => l.stream === 'stderr')
        .slice(-5)
        .map((l) => l.text)
        .join('\n');
      const diagnosticMessage =
        job.errorMessage ?? (stderrLines || 'patrol crashed before any tests ran');
      result.failures.push({
        file: '',
        test: '',
        error: diagnosticMessage,
        stackTrace: '',
        lastScreenshot: null,
        browserErrors: [],
        durationMs: null,
        logContext: [],
      });
      result.failed = 1;
      const crashedScreenshotHint = buildScreenshotHint(isWebTest, isHeadless, true);
      const diagnosticHints = buildDiagnosticHints(
        isWebTest,
        isHeadless,
        true,
        false,
        debuggerPort,
      );
      return {
        found: true,
        ready: true,
        taskId: job.id,
        status: job.status,
        exitCode: job.exitCode,
        errorMessage: job.errorMessage,
        command: job.command,
        args: job.args,
        crashedBeforeTests: true,
        totalLogLines,
        logTailTruncated,
        ...crashedScreenshotHint,
        diagnosticHints,
        ...result,
      };
    }

    const hasFailures = result.failed > 0;
    const hasBrowserErrors = result.failures.some((f) => f.browserErrors.length > 0);
    const screenshotHint = buildScreenshotHint(isWebTest, isHeadless, hasFailures);
    const diagnosticHints = buildDiagnosticHints(
      isWebTest,
      isHeadless,
      hasFailures,
      hasBrowserErrors,
      debuggerPort,
    );
    return {
      found: true,
      ready: true,
      taskId: job.id,
      status: job.status,
      exitCode: job.exitCode,
      errorMessage: job.errorMessage,
      command: job.command,
      args: job.args,
      totalLogLines,
      logTailTruncated,
      ...screenshotHint,
      diagnosticHints,
      ...result,
    };
  },
});
