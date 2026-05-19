import { describe, expect, it } from 'vitest';
import { platform } from 'node:os';
import { buildPatrolInvocation } from '../../../src/runtime/patrol-cli.js';

const projectRoot = '/abs/proj';
const project = { root: projectRoot, packageName: 'demo', isFlutter: true };
const dartCmd = platform() === 'win32' ? 'dart.bat' : 'dart';

describe('buildPatrolInvocation', () => {
  it('falls back to dart run patrol_cli when no wrapper exists', () => {
    const got = buildPatrolInvocation({
      project,
      patrolArgs: ['test', '--target', 'integration_test/foo_test.dart'],
      useRawCli: false,
    });
    expect(got.kind).toBe('dart-run');
    if (got.kind !== 'dart-run') throw new Error('narrow');
    expect(got.command).toBe(dartCmd);
    expect(got.args).toEqual([
      'run',
      'patrol_cli',
      'test',
      '--target',
      'integration_test/foo_test.dart',
    ]);
  });

  it('honors useRawCli=true even if a wrapper script exists', () => {
    const got = buildPatrolInvocation({
      project,
      patrolArgs: ['test'],
      useRawCli: true,
      knownWrapperPath: '/abs/proj/scripts/run_patrol_web.ps1',
    });
    expect(got.kind).toBe('dart-run');
  });

  it('uses the wrapper script when one is provided (Windows .ps1)', () => {
    const wrapper = '/abs/proj/scripts/run_patrol_web.ps1';
    const got = buildPatrolInvocation({
      project,
      patrolArgs: ['test', '--web-port', '4206'],
      knownWrapperPath: wrapper,
    });
    expect(got.kind).toBe('wrapper-script');
    if (got.kind !== 'wrapper-script') throw new Error('narrow');
    expect(got.command).toBe('pwsh');
    expect(got.args).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-File',
      wrapper,
      '--web-port',
      '4206',
    ]);
    expect(got.scriptPath).toBe(wrapper);
  });

  it('uses the wrapper script when one is provided (Unix .sh)', () => {
    const wrapper = '/abs/proj/scripts/run_patrol_web.sh';
    const got = buildPatrolInvocation({
      project,
      patrolArgs: ['test'],
      knownWrapperPath: wrapper,
    });
    expect(got.kind).toBe('wrapper-script');
    if (got.kind !== 'wrapper-script') throw new Error('narrow');
    expect(got.command).toBe('sh');
    expect(got.args).toEqual([wrapper, 'test']);
  });
});
