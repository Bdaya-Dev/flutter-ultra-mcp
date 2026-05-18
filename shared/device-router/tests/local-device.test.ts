import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LocalDevice } from '../src/local-device.js';

describe('LocalDevice', () => {
  const device = new LocalDevice();

  it('has correct identity', () => {
    expect(device.id).toBe('local');
    expect(device.kind).toBe('local');
    const expectedPlatform =
      os.platform() === 'win32' ? 'windows' : os.platform() === 'darwin' ? 'darwin' : 'linux';
    expect(device.platform).toBe(expectedPlatform);
  });

  it('exec runs a command and captures stdout', async () => {
    const cmd = os.platform() === 'win32' ? ['cmd.exe', '/c', 'echo hello'] : ['echo', 'hello'];
    const result = await device.exec(cmd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('exec captures stderr on failure', async () => {
    const cmd =
      os.platform() === 'win32'
        ? ['cmd.exe', '/c', 'echo fail >&2 & exit /b 1']
        : ['sh', '-c', 'echo fail >&2; exit 1'];
    const result = await device.exec(cmd);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.trim()).toBe('fail');
  });

  it('exec respects timeout', async () => {
    const cmd =
      os.platform() === 'win32' ? ['cmd.exe', '/c', 'ping -n 10 127.0.0.1 >nul'] : ['sleep', '10'];
    const result = await device.exec(cmd, { timeoutMs: 500 });
    expect(result.exitCode).not.toBe(0);
  });

  it('exec returns error result for nonexistent command', async () => {
    const result = await device.exec(['nonexistent-command-xyzzy-42']);
    expect(result.exitCode).not.toBe(0);
  });

  it('uploadFile + downloadFile round-trips a file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fu-test-'));
    const srcFile = path.join(tmpDir, 'src.txt');
    const dstFile = path.join(tmpDir, 'sub', 'dst.txt');
    const roundTrip = path.join(tmpDir, 'roundtrip.txt');

    await fs.writeFile(srcFile, 'device-router-test');
    await device.uploadFile(srcFile, dstFile);
    await device.downloadFile(dstFile, roundTrip);

    const content = await fs.readFile(roundTrip, 'utf8');
    expect(content).toBe('device-router-test');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('listDir lists directory contents', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fu-test-'));
    await fs.writeFile(path.join(tmpDir, 'a.txt'), '');
    await fs.mkdir(path.join(tmpDir, 'subdir'));

    const entries = await device.listDir(tmpDir);
    const names = entries.map((e) => e.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('subdir');

    const subdirEntry = entries.find((e) => e.name === 'subdir');
    expect(subdirEntry?.isDirectory).toBe(true);

    const fileEntry = entries.find((e) => e.name === 'a.txt');
    expect(fileEntry?.isDirectory).toBe(false);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('forwardTcpPort returns the same port for local', async () => {
    const fwd = await device.forwardTcpPort('localhost', 8080);
    expect(fwd.localPort).toBe(8080);
    await fwd.close();
  });

  it('probe returns reachable=true', async () => {
    const result = await device.probe();
    expect(result.reachable).toBe(true);
    expect(result.platform).toBeTruthy();
  });

  it('close is a no-op', async () => {
    await expect(device.close()).resolves.toBeUndefined();
  });
});
