import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  NativeKeyring,
  EnvFallbackKeyring,
  envKey,
  createKeyring,
  PACKAGE_NAME,
} from './index.js';

describe('envKey', () => {
  it('converts service + account to screaming snake env var', () => {
    expect(envKey('flutter-ultra', 'sentry-dsn')).toBe('KEYRING_FLUTTER_ULTRA_SENTRY_DSN');
  });

  it('strips non-alphanumeric chars', () => {
    expect(envKey('my.svc', 'user@host')).toBe('KEYRING_MY_SVC_USER_HOST');
  });
});

describe('EnvFallbackKeyring', () => {
  const keyring = new EnvFallbackKeyring();
  const envName = envKey('test-svc', 'test-acct');

  beforeEach(() => {
    delete process.env[envName];
  });

  afterEach(() => {
    delete process.env[envName];
  });

  it('returns null when env var is unset', async () => {
    expect(await keyring.getSecret('test-svc', 'test-acct')).toBeNull();
  });

  it('returns value when env var is set', async () => {
    process.env[envName] = 'my-secret-value';
    expect(await keyring.getSecret('test-svc', 'test-acct')).toBe('my-secret-value');
  });

  it('setSecret throws (read-only)', async () => {
    await expect(keyring.setSecret('test-svc', 'test-acct', 'val')).rejects.toThrow('read-only');
  });

  it('deleteSecret throws (read-only)', async () => {
    await expect(keyring.deleteSecret('test-svc', 'test-acct')).rejects.toThrow('read-only');
  });
});

describe('NativeKeyring', () => {
  const keyring = new NativeKeyring();
  const service = 'flutter-ultra-test';
  const account = `ci-${Date.now()}`;

  afterEach(async () => {
    try {
      await keyring.deleteSecret(service, account);
    } catch {
      // ignore cleanup errors
    }
  });

  it('round-trips set then get then delete', async () => {
    await keyring.setSecret(service, account, 'test-password-42');
    const retrieved = await keyring.getSecret(service, account);
    expect(retrieved).toBe('test-password-42');

    const deleted = await keyring.deleteSecret(service, account);
    expect(deleted).toBe(true);

    const afterDelete = await keyring.getSecret(service, account);
    expect(afterDelete).toBeNull();
  });

  it('getSecret returns null for nonexistent entry', async () => {
    const result = await keyring.getSecret(service, `nonexistent-${Date.now()}`);
    expect(result).toBeNull();
  });

  it('deleteSecret does not throw for nonexistent entry', async () => {
    const result = await keyring.deleteSecret(service, `nonexistent-${Date.now()}`);
    expect(typeof result).toBe('boolean');
  });
});

describe('createKeyring', () => {
  it('returns a NativeKeyring instance', () => {
    const keyring = createKeyring();
    expect(keyring).toBeInstanceOf(NativeKeyring);
  });
});

describe('PACKAGE_NAME', () => {
  it('matches the expected value', () => {
    expect(PACKAGE_NAME).toBe('@flutter-ultra/keyring');
  });
});
