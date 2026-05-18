import { describe, it, expect, beforeAll } from 'vitest';
import * as os from 'node:os';
import { WslDevice, listWslDistros } from '../src/wsl-device.js';

const isWindows = os.platform() === 'win32';

describe('WslDevice', () => {
  let distros: string[] = [];
  let device: WslDevice | undefined;

  beforeAll(async () => {
    if (isWindows) {
      distros = await listWslDistros();
      // Use Debian (not docker-desktop) if available
      const preferred = distros.find((d) => !d.toLowerCase().includes('docker'));
      const distro = preferred ?? distros[0];
      if (distro) {
        device = new WslDevice(distro);
      }
    }
  });

  describe('listWslDistros', () => {
    it.skipIf(!isWindows)('returns an array on Windows', async () => {
      expect(Array.isArray(distros)).toBe(true);
      expect(distros.length).toBeGreaterThan(0);
    });

    it.skipIf(isWindows)('returns empty on non-Windows', async () => {
      const result = await listWslDistros();
      expect(result).toEqual([]);
    });
  });

  describe('integration (WSL exec)', () => {
    it.skipIf(!isWindows)('has correct identity', () => {
      if (!device) return;
      expect(device.id).toMatch(/^wsl:/);
      expect(device.kind).toBe('wsl');
      expect(device.platform).toBe('linux');
    });

    it.skipIf(!isWindows)('exec runs uname', async () => {
      if (!device) return;
      const result = await device.exec(['uname', '-s']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('Linux');
    });

    it.skipIf(!isWindows)('exec captures stderr', async () => {
      if (!device) return;
      const result = await device.exec(['sh', '-c', 'echo err >&2; exit 1']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.trim()).toBe('err');
    });

    it.skipIf(!isWindows)('probe returns reachable=true with Linux platform', async () => {
      if (!device) return;
      const probe = await device.probe();
      expect(probe.reachable).toBe(true);
      expect(probe.platform).toBe('Linux');
    });

    it.skipIf(!isWindows)('forwardTcpPort returns same port for localhost', async () => {
      if (!device) return;
      const fwd = await device.forwardTcpPort('localhost', 9090);
      expect(fwd.localPort).toBe(9090);
      await fwd.close();
    });

    it.skipIf(!isWindows)('forwardTcpPort throws for non-loopback', async () => {
      if (!device) return;
      await expect(device.forwardTcpPort('10.0.0.1', 80)).rejects.toThrow(/non-loopback/i);
    });

    it.skipIf(!isWindows)('close is safe to call', async () => {
      if (!device) return;
      await expect(device.close()).resolves.toBeUndefined();
    });
  });
});

describe('WslDevice unit (no WSL required)', () => {
  const device = new WslDevice('TestDistro');

  it('has correct id and kind', () => {
    expect(device.id).toBe('wsl:TestDistro');
    expect(device.kind).toBe('wsl');
    expect(device.platform).toBe('linux');
  });

  it('forwardTcpPort localhost returns no-op tunnel', async () => {
    const fwd = await device.forwardTcpPort('127.0.0.1', 3000);
    expect(fwd.localPort).toBe(3000);
    await fwd.close();
  });

  it('forwardTcpPort rejects non-loopback', async () => {
    await expect(device.forwardTcpPort('192.168.1.1', 22)).rejects.toThrow(/non-loopback/);
  });
});
