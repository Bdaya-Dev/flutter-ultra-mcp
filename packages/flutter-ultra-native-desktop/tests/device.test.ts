import { describe, expect, it } from 'vitest';
import { LocalLinuxDevice, SshDevice, WslDevice } from '../src/device.js';

describe('LocalLinuxDevice', () => {
  const device = new LocalLinuxDevice();

  it('identifies as local linux', () => {
    expect(device.id).toBe('local');
    expect(device.kind).toBe('local');
    expect(device.platform).toBe('linux');
  });

  it('executes a simple node command and captures stdout', async () => {
    // Use node itself — guaranteed available across all host platforms.
    const result = await device.exec(['node', '-e', "process.stdout.write('hello')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
  });

  it('captures stderr from a non-zero exit', async () => {
    const result = await device.exec([
      'node',
      '-e',
      "process.stderr.write('boom'); process.exit(3)",
    ]);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('boom');
  });

  it('passes input on stdin', async () => {
    const result = await device.exec(
      [
        'node',
        '-e',
        "let buf='';process.stdin.on('data',c=>buf+=c).on('end',()=>process.stdout.write('got:'+buf))",
      ],
      { input: 'payload' },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('got:payload');
  });

  it('honours timeoutMs by killing the process', async () => {
    await expect(
      device.exec(['node', '-e', 'setInterval(()=>{},1000)'], { timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/);
  });

  it('rejects on empty cmd array', async () => {
    await expect(device.exec([])).rejects.toThrow();
  });

  it('probe reflects host platform', async () => {
    const result = await device.probe();
    expect(result.platform).toBe('linux');
    // On a non-linux host (CI on windows-latest/macos-latest), reachable is false.
    if (process.platform !== 'linux') {
      expect(result.reachable).toBe(false);
      expect(result.notes.join('\n')).toMatch(/not.*linux|host platform/i);
    } else {
      expect(result.reachable).toBe(true);
    }
  });
});

describe('WslDevice (placeholder)', () => {
  it('throws on construction — implementation lives in @flutter-ultra/device-router', () => {
    expect(() => new WslDevice('Ubuntu-22.04')).toThrow(/device-router/);
  });
});

describe('SshDevice (placeholder)', () => {
  it('throws on construction — implementation lives in @flutter-ultra/device-router', () => {
    expect(() => new SshDevice('user@host')).toThrow(/device-router/);
  });
});
