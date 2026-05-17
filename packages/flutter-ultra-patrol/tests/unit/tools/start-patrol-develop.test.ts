import { describe, expect, it } from 'vitest';
import {
  buildDevelopArgs,
  startPatrolDevelopTool,
} from '../../../src/tools/start-patrol-develop.js';

describe('start_patrol_develop input schema', () => {
  it('requires projectRoot and target', () => {
    expect(startPatrolDevelopTool.inputSchema.safeParse({}).success).toBe(false);
    expect(startPatrolDevelopTool.inputSchema.safeParse({ projectRoot: '/x' }).success).toBe(false);
  });

  it('accepts minimal valid input', () => {
    expect(
      startPatrolDevelopTool.inputSchema.safeParse({
        projectRoot: '/x',
        target: 'integration_test/foo_test.dart',
      }).success,
    ).toBe(true);
  });
});

describe('buildDevelopArgs', () => {
  it('emits develop with required --target', () => {
    expect(
      buildDevelopArgs({
        projectRoot: '/x',
        target: 'integration_test/foo_test.dart',
      }),
    ).toEqual(['develop', '--target', 'integration_test/foo_test.dart']);
  });

  it('passes device / flavor / buildMode + dartDefines', () => {
    const args = buildDevelopArgs({
      projectRoot: '/x',
      target: 't.dart',
      device: 'chrome',
      flavor: 'stg',
      buildMode: 'debug',
      dartDefines: { ENV: 'dev' },
    });
    expect(args).toEqual([
      'develop',
      '--target',
      't.dart',
      '--device',
      'chrome',
      '--flavor',
      'stg',
      '--debug',
      '--dart-define',
      'ENV=dev',
    ]);
  });

  it('honors openDevtools', () => {
    const args = buildDevelopArgs({
      projectRoot: '/x',
      target: 't.dart',
      openDevtools: true,
    });
    expect(args).toContain('--open-devtools');
  });
});
