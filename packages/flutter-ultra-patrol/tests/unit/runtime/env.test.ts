import { describe, expect, it } from 'vitest';
import { readEnv, resolveBundledPatrolCli, resolveFromProject } from '../../../src/runtime/env.js';

describe('readEnv', () => {
  it('returns empty defaults when no env is injected', () => {
    const env = readEnv({});
    expect(env.patrolForkPath).toBe('');
    expect(env.stateDir).toBe('');
    expect(env.webBrowserArgs).toBe('');
    expect(env.logLevel).toBe('info');
  });

  it('honors FLUTTER_ULTRA_PATROL_FORK / STATE_DIR / PATROL_WEB_BROWSER_ARGS', () => {
    const env = readEnv({
      FLUTTER_ULTRA_PATROL_FORK: '/abs/vendor/patrol',
      FLUTTER_ULTRA_STATE_DIR: '/abs/state',
      PATROL_WEB_BROWSER_ARGS: '--a,--b',
    });
    expect(env.patrolForkPath).toBe('/abs/vendor/patrol');
    expect(env.stateDir).toBe('/abs/state');
    expect(env.webBrowserArgs).toBe('--a,--b');
  });

  it('parses log level; unknown values fall back to info', () => {
    expect(readEnv({ FLUTTER_ULTRA_LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
    expect(readEnv({ FLUTTER_ULTRA_LOG_LEVEL: 'banana' }).logLevel).toBe('info');
  });
});

describe('resolveFromProject', () => {
  it('returns absolute paths unchanged', () => {
    const abs = process.platform === 'win32' ? 'C:\\tmp\\x' : '/tmp/x';
    expect(resolveFromProject('/anything', abs)).toBe(abs);
  });

  it('resolves relative paths against the project root', () => {
    const root = process.platform === 'win32' ? 'C:\\proj' : '/proj';
    const got = resolveFromProject(root, 'sub/file.dart');
    expect(got.endsWith('sub' + (process.platform === 'win32' ? '\\' : '/') + 'file.dart')).toBe(
      true,
    );
  });
});

describe('resolveBundledPatrolCli', () => {
  it('returns null when fork path is not set', () => {
    const env = readEnv({});
    expect(resolveBundledPatrolCli(env)).toBeNull();
  });

  it('returns null when bin/main.dart does not exist under the fork path', () => {
    const env = readEnv({ FLUTTER_ULTRA_PATROL_FORK: '/does/not/exist' });
    expect(resolveBundledPatrolCli(env)).toBeNull();
  });
});
