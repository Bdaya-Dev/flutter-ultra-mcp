// Parse structured pass/fail/skip results out of a completed patrol_cli
// test run.
//
// Web runs emit Playwright-style JSON to stdout when --web-reporter json
// is set; native (Android/iOS) runs emit dart_test "TestEvent"-style JSON
// when --reporter expanded is replaced with --reporter json on the
// underlying flutter test. For the v1.0 surface we focus on the *log-tail*
// heuristics that work for both reporters out-of-the-box: lines like
//   "PASS  integration_test/foo_test.dart"
//   "FAIL  integration_test/foo_test.dart -- some test name"
// because they are emitted by patrol_cli's own pretty-printer regardless
// of the underlying Flutter reporter. Structured JSON parsing is a
// follow-up that requires reporter flag wiring (out of v1.0 scope per
// AC-P2: "structured pass/fail with screenshots").

import type { JobLogLine } from '../runtime/job-store.js';

export interface ParsedFailure {
  /** File path, project-relative. */
  file: string;
  /** Test name (when extractable). Empty string if patrol only logged file-level fail. */
  test: string;
  /** Error message (first line of the diagnostic block). */
  error: string;
  /** Stack trace fragment (best-effort; empty if not in log tail). */
  stackTrace: string;
  /** Last screenshot path mentioned in the log relative to project. Null if none. */
  lastScreenshot: string | null;
  /** Browser console errors observed during the failure (web only). */
  browserErrors: string[];
  /** Duration of this specific test in ms, parsed from patrol_cli output. Null if not present. */
  durationMs: number | null;
  /** Last ~10 log lines before the FAIL line, giving surrounding context. */
  logContext: string[];
}

export interface ParsedTestPass {
  file: string;
  test: string;
  durationMs: number | null;
}

export interface ParsedTestResult {
  passed: number;
  failed: number;
  skipped: number;
  /** Wall-clock duration of the entire run in ms — caller passes this. */
  durationMs: number;
  failures: ParsedFailure[];
  passes: ParsedTestPass[];
  /** Human-readable summary, e.g. "3 passed, 1 failed, 0 skipped in 45.2s". */
  summary: string;
}

const DURATION_SUFFIX = /\s+\((\d+(?:\.\d+)?)s\)$/;
const PASS_LINE = /^PASS\s+(\S+?)(?:\s+--\s+(.+?))?(?:\s+\(\d+(?:\.\d+)?s\))?$/;
const FAIL_LINE = /^FAIL\s+(\S+?)(?:\s+--\s+(.+?))?(?:\s+\(\d+(?:\.\d+)?s\))?$/;
const SKIP_LINE = /^SKIP\s+(\S+?)(?:\s+--\s+(.+?))?(?:\s+\(\d+(?:\.\d+)?s\))?$/;
const SCREENSHOT_LINE =
  /(?:screenshot saved (?:to|at)|wrote screenshot to|screenshot:|screenshot path:)\s*["']?(\S+\.(?:png|jpg|jpeg))["']?/i;
const BROWSER_ERROR_LINE = /\[browser-error\]\s+(.+)$/i;
const STACK_FRAME_LINE = /^\s+#\d+\s+/;

const LOG_CONTEXT_WINDOW = 10;

function parseDurationMs(line: string): number | null {
  const m = line.match(DURATION_SUFFIX);
  if (!m || !m[1]) return null;
  return Math.round(parseFloat(m[1]) * 1000);
}

export function parseTestResults(logTail: JobLogLine[], durationMs: number): ParsedTestResult {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: ParsedFailure[] = [];
  const passes: ParsedTestPass[] = [];
  let lastScreenshot: string | null = null;
  let pendingBrowserErrors: string[] = [];
  // Sliding window of recent log lines for failure context
  const recentLines: string[] = [];

  for (let i = 0; i < logTail.length; i++) {
    const entry = logTail[i];
    if (!entry) continue;
    const line = entry.text;

    const ssMatch = line.match(SCREENSHOT_LINE);
    if (ssMatch && ssMatch[1]) {
      lastScreenshot = ssMatch[1];
    }

    const beMatch = line.match(BROWSER_ERROR_LINE);
    if (beMatch && beMatch[1]) {
      pendingBrowserErrors.push(beMatch[1]);
    }

    const passMatch = line.match(PASS_LINE);
    if (passMatch) {
      passed += 1;
      passes.push({
        file: passMatch[1] ?? '',
        test: passMatch[2] ?? '',
        durationMs: parseDurationMs(line),
      });
      pendingBrowserErrors = [];
      recentLines.push(line);
      if (recentLines.length > LOG_CONTEXT_WINDOW) recentLines.shift();
      continue;
    }
    if (SKIP_LINE.test(line)) {
      skipped += 1;
      recentLines.push(line);
      if (recentLines.length > LOG_CONTEXT_WINDOW) recentLines.shift();
      continue;
    }

    const failMatch = line.match(FAIL_LINE);
    if (failMatch) {
      failed += 1;
      const file = failMatch[1] ?? '';
      const test = failMatch[2] ?? '';
      const next = logTail[i + 1]?.text ?? '';
      const stackTrace = collectStackFrames(logTail, i + 1);
      failures.push({
        file,
        test,
        error: next.trim(),
        stackTrace,
        lastScreenshot,
        browserErrors: pendingBrowserErrors.slice(),
        durationMs: parseDurationMs(line),
        logContext: recentLines.slice(),
      });
      pendingBrowserErrors = [];
      recentLines.push(line);
      if (recentLines.length > LOG_CONTEXT_WINDOW) recentLines.shift();
      continue;
    }

    recentLines.push(line);
    if (recentLines.length > LOG_CONTEXT_WINDOW) recentLines.shift();
  }

  const totalSec = (durationMs / 1000).toFixed(1);
  const summary = `${passed} passed, ${failed} failed, ${skipped} skipped in ${totalSec}s`;

  return { passed, failed, skipped, durationMs, failures, passes, summary };
}

function collectStackFrames(logTail: JobLogLine[], startIdx: number): string {
  const frames: string[] = [];
  for (let i = startIdx; i < logTail.length && frames.length < 16; i++) {
    const text = logTail[i]?.text ?? '';
    if (STACK_FRAME_LINE.test(text)) {
      frames.push(text.trimEnd());
    } else if (frames.length > 0) {
      break;
    }
  }
  return frames.join('\n');
}
