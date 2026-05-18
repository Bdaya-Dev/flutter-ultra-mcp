import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import { SshDevice, listSshHosts } from '../src/ssh-device.js';

describe('SshDevice unit', () => {
  it('has correct id and kind', () => {
    const device = new SshDevice({ host: 'example.com', user: 'deploy' });
    expect(device.id).toBe('ssh:deploy@example.com');
    expect(device.kind).toBe('ssh');
  });

  it('probe returns reachable=false for unreachable host', async () => {
    const device = new SshDevice({ host: '192.0.2.1', user: 'test' });
    const probe = await device.probe();
    expect(probe.reachable).toBe(false);
    expect(probe.errors.length).toBeGreaterThan(0);
  });

  it('close is safe to call without connect', async () => {
    const device = new SshDevice({ host: 'example.com', user: 'test' });
    await expect(device.close()).resolves.toBeUndefined();
  });
});

describe('listSshHosts', () => {
  it('returns an array', async () => {
    const hosts = await listSshHosts();
    expect(Array.isArray(hosts)).toBe(true);
  });

  it('entries have host field', async () => {
    const hosts = await listSshHosts();
    for (const h of hosts) {
      expect(typeof h.host).toBe('string');
      expect(h.host.length).toBeGreaterThan(0);
    }
  });

  // If user has SSH config, verify it doesn't include wildcard entries
  it('excludes wildcard hosts', async () => {
    const hosts = await listSshHosts();
    for (const h of hosts) {
      expect(h.host).not.toContain('*');
      expect(h.host).not.toContain('?');
    }
  });
});
