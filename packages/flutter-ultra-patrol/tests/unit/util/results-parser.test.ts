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

  it('returns zeros when log tail is empty', () => {
    const got = parseTestResults([], 0);
    expect(got).toEqual({
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      failures: [],
    });
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
});
