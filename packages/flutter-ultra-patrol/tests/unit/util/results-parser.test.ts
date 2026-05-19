import { describe, expect, it } from 'vitest';
import { parseTestResults } from '../../../src/util/results-parser.js';
import type { JobLogLine } from '../../../src/runtime/job-store.js';

function line(text: string, stream: 'stdout' | 'stderr' = 'stdout', ts = 0): JobLogLine {
  return { ts, stream, text };
}

describe('parseTestResults', () => {
  it('counts passes / fails / skips', () => {
    const tail: JobLogLine[] = [
      line('PASS  integration_test/login_test.dart'),
      line('FAIL  integration_test/cart_test.dart -- add to cart'),
      line('    AssertionError: expected 1 to equal 2'),
      line('SKIP  integration_test/wip_test.dart'),
    ];
    const got = parseTestResults(tail, 12_000);
    expect(got.passed).toBe(1);
    expect(got.failed).toBe(1);
    expect(got.skipped).toBe(1);
    expect(got.durationMs).toBe(12_000);
    expect(got.failures).toHaveLength(1);
    expect(got.failures[0]!.test).toBe('add to cart');
    expect(got.failures[0]!.error).toContain('AssertionError');
  });

  it('captures the last screenshot and browser errors attached to each failure', () => {
    const tail: JobLogLine[] = [
      line('screenshot saved to /tmp/before.png'),
      line('[browser-error] TypeError: foo is undefined'),
      line('FAIL  integration_test/foo_test.dart -- broken'),
      line('Exception: thing exploded'),
      line('  #0  Foo.bar (package:demo/foo.dart:10:5)'),
      line('  #1  main (package:demo/main.dart:3:7)'),
    ];
    const got = parseTestResults(tail, 5_000);
    expect(got.failures).toHaveLength(1);
    const f = got.failures[0]!;
    expect(f.lastScreenshot).toBe('/tmp/before.png');
    expect(f.browserErrors).toEqual(['TypeError: foo is undefined']);
    expect(f.stackTrace).toContain('#0  Foo.bar');
    expect(f.stackTrace).toContain('#1  main');
  });

  it('returns zeros and empty passes/failures when log tail is empty', () => {
    const got = parseTestResults([], 0);
    expect(got.passed).toBe(0);
    expect(got.failed).toBe(0);
    expect(got.skipped).toBe(0);
    expect(got.durationMs).toBe(0);
    expect(got.failures).toEqual([]);
    expect(got.passes).toEqual([]);
    expect(got.summary).toBe('0 passed, 0 failed, 0 skipped in 0.0s');
  });

  it('resets pending browser errors after a PASS', () => {
    const tail: JobLogLine[] = [
      line('[browser-error] noise before pass'),
      line('PASS  integration_test/a_test.dart'),
      line('FAIL  integration_test/b_test.dart -- second'),
      line('boom'),
    ];
    const got = parseTestResults(tail, 0);
    expect(got.failures[0]!.browserErrors).toEqual([]);
  });

  it('parses per-test duration from timing suffix', () => {
    const tail: JobLogLine[] = [
      line('PASS  integration_test/login_test.dart (3.5s)'),
      line('FAIL  integration_test/cart_test.dart -- add to cart (1.2s)'),
      line('boom'),
      line('PASS  integration_test/no_timing.dart'),
    ];
    const got = parseTestResults(tail, 10_000);
    expect(got.passes[0]!.durationMs).toBe(3500);
    expect(got.failures[0]!.durationMs).toBe(1200);
    expect(got.passes[1]!.durationMs).toBeNull();
  });

  it('populates passes array with file, test, and durationMs', () => {
    const tail: JobLogLine[] = [
      line('PASS  integration_test/login_test.dart -- logs in successfully (5.2s)'),
      line('PASS  integration_test/home_test.dart'),
    ];
    const got = parseTestResults(tail, 8_000);
    expect(got.passes).toHaveLength(2);
    expect(got.passes[0]).toEqual({
      file: 'integration_test/login_test.dart',
      test: 'logs in successfully',
      durationMs: 5200,
    });
    expect(got.passes[1]).toEqual({
      file: 'integration_test/home_test.dart',
      test: '',
      durationMs: null,
    });
  });

  it('includes logContext with up to 10 lines before each failure', () => {
    const tail: JobLogLine[] = [
      line('log line 1'),
      line('log line 2'),
      line('log line 3'),
      line('PASS  integration_test/a_test.dart'),
      line('log line 5'),
      line('log line 6'),
      line('log line 7'),
      line('log line 8'),
      line('log line 9'),
      line('log line 10'),
      line('log line 11'),
      line('log line 12'),
      line('FAIL  integration_test/b_test.dart -- broken'),
      line('error here'),
    ];
    const got = parseTestResults(tail, 5_000);
    const ctx = got.failures[0]!.logContext;
    // Window is capped at 10 entries
    expect(ctx.length).toBeLessThanOrEqual(10);
    // Should contain recent lines leading up to the FAIL
    expect(ctx).toContain('log line 12');
    expect(ctx).toContain('log line 11');
    // Should NOT contain the FAIL line itself
    expect(ctx).not.toContain('FAIL  integration_test/b_test.dart -- broken');
  });

  it('generates a correct summary string', () => {
    const tail: JobLogLine[] = [
      line('PASS  integration_test/a_test.dart'),
      line('PASS  integration_test/b_test.dart'),
      line('PASS  integration_test/c_test.dart'),
      line('FAIL  integration_test/d_test.dart -- broken'),
      line('err'),
      line('SKIP  integration_test/e_test.dart'),
    ];
    const got = parseTestResults(tail, 45_200);
    expect(got.summary).toBe('3 passed, 1 failed, 1 skipped in 45.2s');
  });

  it('captures screenshot from alternative path formats', () => {
    const formats = [
      'wrote screenshot to /tmp/shot1.png',
      'screenshot: /tmp/shot2.png',
      'screenshot path: /tmp/shot3.png',
      'Screenshot saved at /tmp/shot4.png',
    ];
    for (const fmt of formats) {
      const tail: JobLogLine[] = [
        line(fmt),
        line('FAIL  integration_test/x_test.dart -- x'),
        line('err'),
      ];
      const got = parseTestResults(tail, 0);
      expect(got.failures[0]!.lastScreenshot).toMatch(/\/tmp\/shot\d\.png/);
    }
  });
});
