export const PACKAGE_NAME = '@flutter-ultra/keyring';

import { AsyncEntry } from '@napi-rs/keyring';

export interface Keyring {
  getSecret(service: string, account: string): Promise<string | null>;
  setSecret(service: string, account: string, value: string): Promise<void>;
  deleteSecret(service: string, account: string): Promise<boolean>;
}

export class NativeKeyring implements Keyring {
  async getSecret(service: string, account: string): Promise<string | null> {
    const entry = new AsyncEntry(service, account);
    try {
      return await entry.getPassword();
    } catch {
      return null;
    }
  }

  async setSecret(service: string, account: string, value: string): Promise<void> {
    const entry = new AsyncEntry(service, account);
    await entry.setPassword(value);
  }

  async deleteSecret(service: string, account: string): Promise<boolean> {
    const entry = new AsyncEntry(service, account);
    try {
      await entry.deletePassword();
      return true;
    } catch {
      return false;
    }
  }
}

export class EnvFallbackKeyring implements Keyring {
  async getSecret(service: string, account: string): Promise<string | null> {
    return process.env[envKey(service, account)] ?? null;
  }

  async setSecret(_service: string, _account: string, _value: string): Promise<void> {
    throw new Error(
      'EnvFallbackKeyring is read-only — set secrets via environment variables directly.',
    );
  }

  async deleteSecret(_service: string, _account: string): Promise<boolean> {
    throw new Error('EnvFallbackKeyring is read-only — unset environment variables directly.');
  }
}

export function envKey(service: string, account: string): string {
  return `KEYRING_${service}_${account}`.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
}

export function createKeyring(): Keyring {
  return new NativeKeyring();
}
