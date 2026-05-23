import { describe, expect, it, vi } from 'vitest';
import { AndroidDevice } from './android.js';
import { IosSimDevice } from './ios.js';
import type { ExecFn } from './ssh.js';
import type { ShellResult } from './device.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeOkResult(stdout = ''): ShellResult {
  return { ok: true, stdout, stderr: '', exitCode: 0, signal: null, durationMs: 1 };
}

function mockExecFn(): { exec: ExecFn; calls: ReadonlyArray<readonly string[]> } {
  const calls: (readonly string[])[] = [];
  const exec: ExecFn = vi.fn(async (argv: readonly string[]) => {
    calls.push(argv);
    return makeOkResult();
  });
  return { exec, calls };
}

// ─── AndroidDevice with injected ExecFn ───────────────────────────────────

describe('AndroidDevice with injected exec', () => {
  it('routes shell() through exec with adb -s <id> shell prefix', async () => {
    const { exec, calls } = mockExecFn();
    const device = new AndroidDevice('test-device-id', 'adb', exec);

    await device.shell(['ls', '-la']);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['adb', '-s', 'test-device-id', 'shell', 'ls', '-la']);
  });

  it('routes adb() through exec with adb -s <id> prefix', async () => {
    const { exec, calls } = mockExecFn();
    const device = new AndroidDevice('test-device-id', 'adb', exec);

    await device.adb(['push', 'local.apk', '/data/local/tmp/app.apk']);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'adb',
      '-s',
      'test-device-id',
      'push',
      'local.apk',
      '/data/local/tmp/app.apk',
    ]);
  });

  it('uses custom adbPath in exec calls', async () => {
    const { exec, calls } = mockExecFn();
    const device = new AndroidDevice('test-id', '/usr/local/bin/adb', exec);

    await device.shell(['echo', 'hello']);

    expect(calls[0]?.[0]).toBe('/usr/local/bin/adb');
  });

  it('passes empty shell argv and still calls exec', async () => {
    const { exec, calls } = mockExecFn();
    const device = new AndroidDevice('test-id', 'adb', exec);

    // shell([]) on the base class returns early without calling exec;
    // test with a real arg to verify the routing
    await device.shell(['true']);
    expect(calls).toHaveLength(1);
  });

  it('multiple sequential calls accumulate in calls array', async () => {
    const { exec, calls } = mockExecFn();
    const device = new AndroidDevice('dev-123', 'adb', exec);

    await device.shell(['ls']);
    await device.adb(['get-state']);
    await device.shell(['pwd']);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(['adb', '-s', 'dev-123', 'shell', 'ls']);
    expect(calls[1]).toEqual(['adb', '-s', 'dev-123', 'get-state']);
    expect(calls[2]).toEqual(['adb', '-s', 'dev-123', 'shell', 'pwd']);
  });
});

// ─── IosSimDevice with injected ExecFn ────────────────────────────────────

describe('IosSimDevice with injected exec', () => {
  it('routes shell() through exec with xcrun simctl spawn <id> prefix', async () => {
    const { exec, calls } = mockExecFn();
    const device = new IosSimDevice('test-uuid-1234', 'xcrun', exec);

    await device.shell(['ls']);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['xcrun', 'simctl', 'spawn', 'test-uuid-1234', 'ls']);
  });

  it('routes simctl() through exec with xcrun simctl prefix', async () => {
    const { exec, calls } = mockExecFn();
    const device = new IosSimDevice('test-uuid-1234', 'xcrun', exec);

    await device.simctl(['openurl', 'test-uuid-1234', 'https://example.com']);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'xcrun',
      'simctl',
      'openurl',
      'test-uuid-1234',
      'https://example.com',
    ]);
  });

  it('uses custom xcrunPath in exec calls', async () => {
    const { exec, calls } = mockExecFn();
    const device = new IosSimDevice('uuid', '/usr/bin/xcrun', exec);

    await device.shell(['ls']);

    expect(calls[0]?.[0]).toBe('/usr/bin/xcrun');
  });

  it('shell() with empty argv returns error without calling exec', async () => {
    const { exec, calls } = mockExecFn();
    const device = new IosSimDevice('uuid', 'xcrun', exec);

    const result = await device.shell([]);

    // IosSimDevice guards empty argv and returns early
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe('empty argv');
    expect(calls).toHaveLength(0);
  });

  it('multiple sequential calls accumulate in calls array', async () => {
    const { exec, calls } = mockExecFn();
    const device = new IosSimDevice('sim-uuid', 'xcrun', exec);

    await device.shell(['ls']);
    await device.simctl(['list', 'devices', '-j']);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(['xcrun', 'simctl', 'spawn', 'sim-uuid', 'ls']);
    expect(calls[1]).toEqual(['xcrun', 'simctl', 'list', 'devices', '-j']);
  });
});

// ─── Backward compatibility (no exec param) ────────────────────────────────

describe('backward compatibility — no exec param', () => {
  it('AndroidDevice(id) with no exec param does not throw', () => {
    expect(() => new AndroidDevice('emulator-5554')).not.toThrow();
  });

  it('IosSimDevice(id) with no exec param does not throw', () => {
    expect(() => new IosSimDevice('some-uuid')).not.toThrow();
  });

  it('AndroidDevice(id, adbPath) with no exec param does not throw', () => {
    expect(() => new AndroidDevice('emulator-5554', 'adb')).not.toThrow();
  });

  it('IosSimDevice(id, xcrunPath) with no exec param does not throw', () => {
    expect(() => new IosSimDevice('some-uuid', 'xcrun')).not.toThrow();
  });
});
