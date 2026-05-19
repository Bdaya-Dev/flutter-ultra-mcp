import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildPatrolTestArgs,
  mergeBrowserArgs,
  startPatrolTestTool,
} from '../../../src/tools/start-patrol-test.js';

const baseInput = {
  projectRoot: '/abs/proj',
};

describe('start_patrol_test input schema', () => {
  it('accepts the minimal input shape', () => {
    expect(startPatrolTestTool.inputSchema.safeParse(baseInput).success).toBe(true);
  });

  it('rejects a missing projectRoot', () => {
    const got = startPatrolTestTool.inputSchema.safeParse({});
    expect(got.success).toBe(false);
  });

  it('rejects invalid buildMode', () => {
    const got = startPatrolTestTool.inputSchema.safeParse({
      ...baseInput,
      buildMode: 'turbo',
    });
    expect(got.success).toBe(false);
  });
});

describe('buildPatrolTestArgs', () => {
  it('emits the minimal `test` command for an empty input', () => {
    const args = buildPatrolTestArgs({ projectRoot: '/x' }, '');
    expect(args).toEqual(['test']);
  });

  it('passes target / name / device / flavor / buildMode in CLI order', () => {
    const args = buildPatrolTestArgs(
      {
        projectRoot: '/x',
        target: 'integration_test/foo_test.dart',
        name: '^login',
        device: 'chrome',
        flavor: 'dev',
        buildMode: 'profile',
      },
      '',
    );
    expect(args).toEqual([
      'test',
      '--target',
      'integration_test/foo_test.dart',
      '--name',
      '^login',
      '--device',
      'chrome',
      '--flavor',
      'dev',
      '--profile',
    ]);
  });

  it('expands dartDefines into repeated --dart-define flags', () => {
    const args = buildPatrolTestArgs(
      {
        projectRoot: '/x',
        dartDefines: { A: '1', B: 'hello world', NUM: 42, FLAG: true },
      },
      '',
    );
    expect(args).toContain('--dart-define');
    expect(args).toContain('A=1');
    expect(args).toContain('B=hello world');
    expect(args).toContain('NUM=42');
    expect(args).toContain('FLAG=true');
  });

  it('sets --web-init-timeout default 180000 for web invocations', () => {
    const args = buildPatrolTestArgs({ projectRoot: '/x', web: {} }, '');
    expect(args).toContain('--web-init-timeout');
    expect(args[args.indexOf('--web-init-timeout') + 1]).toBe('180000');
  });

  it('respects custom web.initTimeoutMs', () => {
    const args = buildPatrolTestArgs({ projectRoot: '/x', web: { initTimeoutMs: 90_000 } }, '');
    expect(args[args.indexOf('--web-init-timeout') + 1]).toBe('90000');
  });

  it('merges environment + user-supplied browser args into --web-browser-args', () => {
    const args = buildPatrolTestArgs(
      {
        projectRoot: '/x',
        web: { browserArgs: ['--lang=en-US'] },
      },
      '--enable-features=Vulkan',
      'linux',
    );
    const flagIdx = args.indexOf('--web-browser-args');
    expect(flagIdx).toBeGreaterThan(-1);
    const value = args[flagIdx + 1] ?? '';
    expect(value.includes('--enable-unsafe-swiftshader')).toBe(true);
    expect(value.includes('--enable-features=Vulkan')).toBe(true);
    expect(value.includes('--lang=en-US')).toBe(true);
  });

  it('appends extraArgs verbatim at the tail', () => {
    const args = buildPatrolTestArgs(
      { projectRoot: '/x', extraArgs: ['--verbose', '--no-update-check'] },
      '',
    );
    expect(args.slice(-2)).toEqual(['--verbose', '--no-update-check']);
  });
});

describe('mergeBrowserArgs', () => {
  it('always injects the three safe defaults', () => {
    const got = mergeBrowserArgs('', []);
    expect(got).toContain('--enable-unsafe-swiftshader');
    expect(got).toContain('--disable-renderer-backgrounding');
    expect(got).toContain('--disable-background-timer-throttling');
  });

  it('de-dupes flags by key (split on =)', () => {
    const got = mergeBrowserArgs('--enable-unsafe-swiftshader,--lang=en-US', ['--lang=fr-FR']);
    const langs = got.filter((f) => f.startsWith('--lang='));
    expect(langs).toHaveLength(1);
    expect(langs[0]).toBe('--lang=en-US');
  });

  it('drops empty flags from env splits', () => {
    const got = mergeBrowserArgs(',,--xx', []);
    expect(got.filter((f) => f === '')).toEqual([]);
    expect(got).toContain('--xx');
  });
});

describe('buildPatrolTestArgs — platform-specific browser args (#75)', () => {
  it('emits --web-browser-args on non-Windows platforms', () => {
    const args = buildPatrolTestArgs(
      { projectRoot: '/x', web: { browserArgs: ['--lang=en'] } },
      '',
      'linux',
    );
    expect(args).toContain('--web-browser-args');
  });

  it('omits --web-browser-args on win32 to avoid PowerShell quote stripping', () => {
    const args = buildPatrolTestArgs(
      { projectRoot: '/x', web: { browserArgs: ['--lang=en'] } },
      '',
      'win32',
    );
    expect(args).not.toContain('--web-browser-args');
  });

  it('still emits web init timeout on win32 even without browser args flag', () => {
    const args = buildPatrolTestArgs({ projectRoot: '/x', web: {} }, '', 'win32');
    expect(args).toContain('--web-init-timeout');
  });
});
