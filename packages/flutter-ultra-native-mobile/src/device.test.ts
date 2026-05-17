import { describe, expect, it } from 'vitest';
import { LocalDevice, spawnAwait } from './device.js';

describe('spawnAwait', () => {
  it('returns ok=true + exit 0 for a successful command', async () => {
    const res = await spawnAwait(['node', '-e', 'console.log("hi")'], { timeoutMs: 5_000 });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('hi');
  });

  it('returns ok=false + non-zero exit for a failing command', async () => {
    const res = await spawnAwait(['node', '-e', 'process.exit(2)'], { timeoutMs: 5_000 });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(2);
  });

  it('kills the child when timeoutMs fires', async () => {
    const res = await spawnAwait(['node', '-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 200 });
    expect(res.ok).toBe(false);
  });

  it('kills the child when the abort signal fires', async () => {
    const ctrl = new AbortController();
    const p = spawnAwait(['node', '-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 5_000,
      signal: ctrl.signal,
    });
    setTimeout(() => ctrl.abort(), 100);
    const res = await p;
    expect(res.ok).toBe(false);
  });

  it('forwards stdin input', async () => {
    const res = await spawnAwait(
      ['node', '-e', 'process.stdin.on("data", d => process.stdout.write(d))'],
      { input: 'pumped', timeoutMs: 5_000 },
    );
    expect(res.stdout).toContain('pumped');
  });

  it('surfaces ENOENT as a spawn failure not a throw', async () => {
    const res = await spawnAwait(['this-binary-does-not-exist-xyz'], { timeoutMs: 2_000 });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBeNull();
  });

  it('returns empty-argv error when argv is empty', async () => {
    const res = await spawnAwait([], {});
    expect(res.ok).toBe(false);
    expect(res.stderr).toBe('empty argv');
  });
});

describe('LocalDevice', () => {
  it('shell() runs argv on the local host', async () => {
    const dev = new LocalDevice('local-host-test');
    const res = await dev.shell(['node', '-e', 'process.stdout.write("ok")'], { timeoutMs: 5_000 });
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe('ok');
  });

  it('isAlive always reports true', async () => {
    const dev = new LocalDevice('local-host-test');
    await expect(dev.isAlive()).resolves.toBe(true);
  });

  it('meta returns host=local', async () => {
    const dev = new LocalDevice('local-host-test');
    await expect(dev.meta()).resolves.toEqual({ host: 'local' });
  });
});
