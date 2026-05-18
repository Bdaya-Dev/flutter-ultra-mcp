import { describe, it, expect } from 'vitest';
import { LocalDevice } from '../src/local-device.js';
import { LegacyDeviceAdapter, CanonicalDeviceAdapter } from '../src/adapter.js';
import type { LegacyDevice } from '../src/types.js';

describe('LegacyDeviceAdapter', () => {
  const canonical = new LocalDevice();
  const adapter = new LegacyDeviceAdapter(canonical);

  it('label matches canonical id', () => {
    expect(adapter.label).toBe('local');
  });

  it('isLocal is true for local device', () => {
    expect(adapter.isLocal).toBe(true);
  });

  it('exec delegates to canonical device', async () => {
    const cmd =
      process.platform === 'win32'
        ? ['cmd.exe', '/c', 'echo legacy-test']
        : ['echo', 'legacy-test'];
    const result = await adapter.exec(cmd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('legacy-test');
  });

  it('fileExists works for existing and missing paths', async () => {
    if (process.platform === 'win32') {
      // test -e doesn't work on Windows without WSL/bash
      return;
    }
    const exists = await adapter.fileExists('/tmp');
    expect(exists).toBe(true);
    const missing = await adapter.fileExists('/nonexistent-path-xyzzy-42');
    expect(missing).toBe(false);
  });

  it('openRpcStream delegates to forwardTcpPort', async () => {
    const stream = await adapter.openRpcStream('localhost', 8080);
    expect(stream.localPort).toBe(8080);
    await stream.close();
  });
});

describe('CanonicalDeviceAdapter', () => {
  const mockLegacy: LegacyDevice = {
    label: 'mock-legacy',
    isLocal: false,
    async exec(cmd) {
      return { exitCode: 0, stdout: cmd.join(' '), stderr: '', durationMs: 1 };
    },
    async uploadFile() {},
    async fileExists() {
      return true;
    },
    async openRpcStream(_host, port) {
      return { localPort: port, close: async () => {} };
    },
  };

  const adapter = new CanonicalDeviceAdapter(mockLegacy, {
    id: 'test:mock',
    kind: 'ssh',
    platform: 'darwin',
  });

  it('has correct identity', () => {
    expect(adapter.id).toBe('test:mock');
    expect(adapter.kind).toBe('ssh');
    expect(adapter.platform).toBe('darwin');
  });

  it('exec delegates to legacy', async () => {
    const result = await adapter.exec(['flutter', 'build']);
    expect(result.stdout).toBe('flutter build');
  });

  it('forwardTcpPort delegates to openRpcStream', async () => {
    const fwd = await adapter.forwardTcpPort('localhost', 5000);
    expect(fwd.localPort).toBe(5000);
    await fwd.close();
  });

  it('spawn throws with migration message', async () => {
    await expect(adapter.spawn(['ls'])).rejects.toThrow(/migrate to canonical/);
  });

  it('downloadFile throws with migration message', async () => {
    await expect(adapter.downloadFile('/tmp/a', '/tmp/b')).rejects.toThrow(/migrate to canonical/);
  });

  it('listDir throws with migration message', async () => {
    await expect(adapter.listDir('/tmp')).rejects.toThrow(/migrate to canonical/);
  });
});
