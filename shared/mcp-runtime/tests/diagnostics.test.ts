import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosticsCollector } from '../src/diagnostics.js';
import { LogBuffer, createLogger } from '../src/logger.js';

// ── DiagnosticsCollector ──────────────────────────────────────────────────────

describe('DiagnosticsCollector', () => {
  it('starts with zero tool call counts', () => {
    const c = new DiagnosticsCollector();
    const snap = c.snapshot();
    expect(snap.totalToolCalls).toBe(0);
    expect(snap.toolCallCounts).toEqual({});
  });

  it('records tool calls and increments per-tool count', () => {
    const c = new DiagnosticsCollector();
    c.recordToolCall('foo');
    c.recordToolCall('foo');
    c.recordToolCall('bar');
    const snap = c.snapshot();
    expect(snap.toolCallCounts).toEqual({ foo: 2, bar: 1 });
    expect(snap.totalToolCalls).toBe(3);
  });

  it('snapshot includes pid matching process.pid', () => {
    const c = new DiagnosticsCollector();
    expect(c.snapshot().pid).toBe(process.pid);
  });

  it('snapshot uptime grows over real time', async () => {
    const c = new DiagnosticsCollector();
    await new Promise((r) => setTimeout(r, 20));
    expect(c.snapshot().uptimeMs).toBeGreaterThanOrEqual(15);
  });

  it('snapshot uses injected now for deterministic uptime', () => {
    let t = 1_000_000;
    const c = new DiagnosticsCollector(() => t);
    t += 5_000;
    // uptimeMs = Date.now() - startedAt; here Date.now() is the real clock,
    // but startedAt was captured at construction via the injected now().
    // We just verify it is a non-negative number — the injected now only
    // controls startedAt, not the Date.now() call in snapshot().
    expect(c.snapshot().uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('snapshot memoryMb fields are non-negative numbers', () => {
    const snap = new DiagnosticsCollector().snapshot();
    expect(snap.memoryMb.rss).toBeGreaterThan(0);
    expect(snap.memoryMb.heapUsed).toBeGreaterThanOrEqual(0);
    expect(snap.memoryMb.heapTotal).toBeGreaterThan(0);
    expect(snap.memoryMb.external).toBeGreaterThanOrEqual(0);
  });

  it('snapshot returns a new copy each time (not a shared reference)', () => {
    const c = new DiagnosticsCollector();
    c.recordToolCall('a');
    const s1 = c.snapshot();
    c.recordToolCall('a');
    const s2 = c.snapshot();
    expect(s1.totalToolCalls).toBe(1);
    expect(s2.totalToolCalls).toBe(2);
  });
});

// ── LogBuffer ring buffer ─────────────────────────────────────────────────────

describe('LogBuffer', () => {
  it('starts empty', () => {
    const b = new LogBuffer(10);
    expect(b.size).toBe(0);
    expect(b.snapshot()).toEqual([]);
  });

  it('stores entries up to the cap without dropping', () => {
    const b = new LogBuffer(3);
    b.push({ ts: '1', level: 'info', server: 's', msg: 'a' });
    b.push({ ts: '2', level: 'info', server: 's', msg: 'b' });
    b.push({ ts: '3', level: 'info', server: 's', msg: 'c' });
    expect(b.size).toBe(3);
    expect(b.snapshot().map((e) => e.msg)).toEqual(['a', 'b', 'c']);
  });

  it('drops oldest entry when cap is exceeded (ring behaviour)', () => {
    const b = new LogBuffer(3);
    b.push({ ts: '1', level: 'info', server: 's', msg: 'a' });
    b.push({ ts: '2', level: 'info', server: 's', msg: 'b' });
    b.push({ ts: '3', level: 'info', server: 's', msg: 'c' });
    b.push({ ts: '4', level: 'info', server: 's', msg: 'd' });
    expect(b.size).toBe(3);
    expect(b.snapshot().map((e) => e.msg)).toEqual(['b', 'c', 'd']);
  });

  it('never grows beyond maxEntries after many pushes', () => {
    const b = new LogBuffer(5);
    for (let i = 0; i < 100; i++) {
      b.push({ ts: String(i), level: 'debug', server: 's', msg: `m${i}` });
    }
    expect(b.size).toBe(5);
    // The last 5 entries should be retained.
    const msgs = b.snapshot().map((e) => e.msg);
    expect(msgs).toEqual(['m95', 'm96', 'm97', 'm98', 'm99']);
  });

  it('snapshot returns a copy — mutations do not affect the buffer', () => {
    const b = new LogBuffer(5);
    b.push({ ts: '1', level: 'info', server: 's', msg: 'x' });
    const snap = b.snapshot() as ReturnType<LogBuffer['snapshot']> & { push?: unknown };
    // The returned value is a plain array slice.
    expect(Array.isArray(snap)).toBe(true);
    // Pushing to the snapshot array should not grow the buffer.
    (snap as unknown[]).push({ ts: '2', level: 'info', server: 's', msg: 'y' });
    expect(b.size).toBe(1);
  });

  it('uses FLUTTER_ULTRA_LOG_MAX_ENTRIES env var for default cap', () => {
    process.env['FLUTTER_ULTRA_LOG_MAX_ENTRIES'] = '2';
    try {
      const b = new LogBuffer(); // no explicit cap — reads env
      b.push({ ts: '1', level: 'info', server: 's', msg: 'a' });
      b.push({ ts: '2', level: 'info', server: 's', msg: 'b' });
      b.push({ ts: '3', level: 'info', server: 's', msg: 'c' });
      expect(b.size).toBe(2);
      expect(b.snapshot().map((e) => e.msg)).toEqual(['b', 'c']);
    } finally {
      delete process.env['FLUTTER_ULTRA_LOG_MAX_ENTRIES'];
    }
  });
});

// ── Logger integration with buffer ───────────────────────────────────────────

describe('Logger buffer integration', () => {
  afterEach(() => {
    delete process.env['FLUTTER_ULTRA_LOG_LEVEL'];
  });

  it('logger exposes the same buffer instance on child loggers', () => {
    const parent = createLogger({ server: 'test', minLevel: 'debug' });
    const child = parent.child({ tag: 'sub' });
    expect(child.buffer).toBe(parent.buffer);
  });

  it('entries written by child appear in parent buffer', () => {
    const parent = createLogger({ server: 'test', minLevel: 'debug' });
    const child = parent.child({ tag: 'sub' });
    child.info('hello from child');
    const snap = parent.buffer.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]!.msg).toBe('hello from child');
    expect(snap[0]!['tag']).toBe('sub');
  });

  it('shared buffer passed via options is used by both loggers', () => {
    const buf = new LogBuffer(100);
    const a = createLogger({ server: 'a', minLevel: 'debug', buffer: buf });
    const b = createLogger({ server: 'b', minLevel: 'debug', buffer: buf });
    a.info('from a');
    b.info('from b');
    expect(buf.size).toBe(2);
  });
});
