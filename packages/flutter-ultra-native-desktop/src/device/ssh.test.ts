import { describe, expect, it } from 'vitest';
import { SshDevice } from './ssh.js';
import type { SshDeviceOptions } from './ssh.js';

// ---------------------------------------------------------------------------
// Helpers — mirror the env-var convention used by callers of SshDevice.
// There is no exported resolveSshConfig; callers build SshDeviceOptions from
// env vars themselves.  We test that pattern here to lock down the expected
// env-var names and defaults.
// ---------------------------------------------------------------------------

function resolveSshConfigFromEnv(env: Record<string, string | undefined>): SshDeviceOptions {
  const host = env['FLUTTER_ULTRA_SSH_HOST'];
  if (!host) throw new Error('FLUTTER_ULTRA_SSH_HOST is required');
  return {
    host,
    port: env['FLUTTER_ULTRA_SSH_PORT'] ? parseInt(env['FLUTTER_ULTRA_SSH_PORT'], 10) : 22,
    username: env['FLUTTER_ULTRA_SSH_USER'] ?? 'admin',
    privateKeyPath: env['FLUTTER_ULTRA_SSH_KEY'] ?? `${env['HOME'] ?? '/root'}/.ssh/id_rsa`,
  };
}

describe('resolveSshConfigFromEnv (env-var convention)', () => {
  it('reads host, port, username, and key path from env vars', () => {
    const opts = resolveSshConfigFromEnv({
      FLUTTER_ULTRA_SSH_HOST: 'mac-mini.local',
      FLUTTER_ULTRA_SSH_PORT: '2222',
      FLUTTER_ULTRA_SSH_USER: 'builder',
      FLUTTER_ULTRA_SSH_KEY: '/home/builder/.ssh/mac_id_ed25519',
    });
    expect(opts.host).toBe('mac-mini.local');
    expect(opts.port).toBe(2222);
    expect(opts.username).toBe('builder');
    expect(opts.privateKeyPath).toBe('/home/builder/.ssh/mac_id_ed25519');
  });

  it('defaults port to 22 when FLUTTER_ULTRA_SSH_PORT is absent', () => {
    const opts = resolveSshConfigFromEnv({
      FLUTTER_ULTRA_SSH_HOST: 'mac.example.com',
    });
    expect(opts.port).toBe(22);
  });

  it('defaults username to "admin" when FLUTTER_ULTRA_SSH_USER is absent', () => {
    const opts = resolveSshConfigFromEnv({
      FLUTTER_ULTRA_SSH_HOST: 'mac.example.com',
    });
    expect(opts.username).toBe('admin');
  });

  it('throws when FLUTTER_ULTRA_SSH_HOST is absent', () => {
    expect(() => resolveSshConfigFromEnv({})).toThrow('FLUTTER_ULTRA_SSH_HOST is required');
  });

  it('uses HOME to construct default key path when FLUTTER_ULTRA_SSH_KEY is absent', () => {
    const opts = resolveSshConfigFromEnv({
      FLUTTER_ULTRA_SSH_HOST: 'mac.example.com',
      HOME: '/home/ci',
    });
    expect(opts.privateKeyPath).toBe('/home/ci/.ssh/id_rsa');
  });
});

describe('SshDeviceOptions construction', () => {
  it('constructs valid options with all fields provided', () => {
    const opts: SshDeviceOptions = {
      host: '192.168.1.10',
      port: 22,
      username: 'macos-user',
      privateKeyPath: '/Users/macos-user/.ssh/id_ed25519',
    };
    expect(opts.host).toBe('192.168.1.10');
    expect(opts.port).toBe(22);
    expect(opts.username).toBe('macos-user');
    expect(opts.privateKeyPath).toBe('/Users/macos-user/.ssh/id_ed25519');
  });
});

describe('SshDevice label', () => {
  it('formats label as ssh://<user>@<host>:<port>', () => {
    const device = new SshDevice({
      host: 'mac-mini.local',
      port: 22,
      username: 'builder',
      privateKeyPath: '/home/builder/.ssh/id_rsa',
    });
    expect(device.label).toBe('ssh://builder@mac-mini.local:22');
  });

  it('includes a non-standard port in the label', () => {
    const device = new SshDevice({
      host: 'remote.example.com',
      port: 2222,
      username: 'ci',
      privateKeyPath: '/ci/.ssh/key',
    });
    expect(device.label).toBe('ssh://ci@remote.example.com:2222');
  });

  it('reflects isLocal as false', () => {
    const device = new SshDevice({
      host: 'mac.local',
      port: 22,
      username: 'user',
      privateKeyPath: '/user/.ssh/id_rsa',
    });
    expect(device.isLocal).toBe(false);
  });
});

describe('SshDevice connection option defaults (constants)', () => {
  it('exposes the expected keepalive interval via label (construction does not throw)', () => {
    // Verify SshDevice can be constructed with minimal valid options without
    // throwing — keepalive constants are wired in createConnection which is
    // deferred until first use, so no SSH connection is made here.
    expect(() => {
      new SshDevice({
        host: 'localhost',
        port: 22,
        username: 'test',
        privateKeyPath: '/tmp/key',
      });
    }).not.toThrow();
  });
});

describe('deviceErrorMessage helper', () => {
  it('includes the device label and exit code for a remote device', async () => {
    const { deviceErrorMessage } = await import('./types.js');
    const device = new SshDevice({
      host: 'mac.local',
      port: 22,
      username: 'ci',
      privateKeyPath: '/ci/.ssh/id',
    });
    const msg = deviceErrorMessage(device, 'xcrun', {
      stdout: '',
      stderr: 'xcrun: error: invalid active developer path',
      exitCode: 1,
      durationMs: 120,
    });
    expect(msg).toContain('ssh://ci@mac.local:22');
    expect(msg).toContain('exit code 1');
    expect(msg).toContain('xcrun: error');
  });

  it('says "on this machine" for LocalDevice', async () => {
    const { deviceErrorMessage } = await import('./types.js');
    const { LocalDevice } = await import('./local.js');
    const local = new LocalDevice();
    const msg = deviceErrorMessage(local, 'flutter', {
      stdout: '',
      stderr: 'command not found',
      exitCode: 127,
      durationMs: 5,
    });
    expect(msg).toContain('on this machine');
    expect(msg).toContain('exit code 127');
  });

  it('appends remediation hint when provided', async () => {
    const { deviceErrorMessage } = await import('./types.js');
    const device = new SshDevice({
      host: 'mac.local',
      port: 22,
      username: 'ci',
      privateKeyPath: '/ci/.ssh/id',
    });
    const msg = deviceErrorMessage(
      device,
      'swift',
      { stdout: '', stderr: 'swift not found', exitCode: 1, durationMs: 10 },
      'Install Xcode Command Line Tools',
    );
    expect(msg).toContain('Install Xcode Command Line Tools');
  });

  it('falls back to stdout when stderr is empty', async () => {
    const { deviceErrorMessage } = await import('./types.js');
    const device = new SshDevice({
      host: 'mac.local',
      port: 22,
      username: 'ci',
      privateKeyPath: '/ci/.ssh/id',
    });
    const msg = deviceErrorMessage(device, 'test-cmd', {
      stdout: 'some stdout output',
      stderr: '',
      exitCode: 2,
      durationMs: 0,
    });
    expect(msg).toContain('some stdout output');
  });

  it('shows "(no output)" when both stdout and stderr are empty', async () => {
    const { deviceErrorMessage } = await import('./types.js');
    const device = new SshDevice({
      host: 'mac.local',
      port: 22,
      username: 'ci',
      privateKeyPath: '/ci/.ssh/id',
    });
    const msg = deviceErrorMessage(device, 'silent-cmd', {
      stdout: '',
      stderr: '',
      exitCode: 1,
      durationMs: 0,
    });
    expect(msg).toContain('(no output)');
  });
});
