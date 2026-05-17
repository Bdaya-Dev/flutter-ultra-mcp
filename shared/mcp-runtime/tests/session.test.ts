import { describe, expect, it } from 'vitest';
import {
  SessionResource,
  SessionsFileSchema,
  emptySessionsFile,
  makeClientName,
} from '../src/index.js';

describe('emptySessionsFile', () => {
  it('returns a valid empty file', () => {
    expect(emptySessionsFile()).toEqual({ schemaVersion: 1, sessions: [] });
    expect(() => SessionsFileSchema.parse(emptySessionsFile())).not.toThrow();
  });
});

describe('makeClientName', () => {
  it('includes server name and process pid', () => {
    const name = makeClientName('runtime');
    expect(name).toMatch(/^flutter-ultra\/runtime\/\d+$/);
  });
});

describe('SessionResource', () => {
  it('reference-counts factory calls — one connection for two acquires', async () => {
    let created = 0;
    let destroyed = 0;
    const res = new SessionResource<string>(
      async () => {
        created += 1;
        return `conn-${created}`;
      },
      async () => {
        destroyed += 1;
      },
    );
    const a = await res.acquire();
    const b = await res.acquire();
    expect(a).toBe('conn-1');
    expect(b).toBe('conn-1');
    expect(created).toBe(1);
    expect(res.count).toBe(2);
    await res.release();
    expect(destroyed).toBe(0); // still held by second acquirer
    await res.release();
    expect(destroyed).toBe(1);
    expect(res.count).toBe(0);
  });

  it('re-creates after full release', async () => {
    let created = 0;
    const res = new SessionResource<number>(
      async () => ++created,
      async () => {},
    );
    const a = await res.acquire();
    await res.release();
    const b = await res.acquire();
    await res.release();
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});
