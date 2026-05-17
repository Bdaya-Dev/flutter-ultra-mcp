import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listTestsTool } from '../../../src/tools/list-tests.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { JobStore } from '../../../src/runtime/job-store.js';
import { DevelopSessionManager } from '../../../src/runtime/develop-session.js';

function makeCtx(): ToolContext {
  return {
    env: {
      patrolForkPath: '',
      stateDir: '',
      webBrowserArgs: '',
      logLevel: 'info',
    },
    jobs: new JobStore(),
    develop: new DevelopSessionManager(),
    now: () => 0,
  };
}

describe('list_tests', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'patrol-list-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects missing projectRoot via input schema', () => {
    expect(listTestsTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('returns empty tests when no test directories exist', async () => {
    await writeFile(join(dir, 'pubspec.yaml'), 'name: demo\n');
    const ctx = makeCtx();
    const out = (await listTestsTool.handler({ projectRoot: dir }, ctx)) as { tests: unknown[] };
    expect(out.tests).toEqual([]);
  });

  it('discovers Patrol tests across integration_test/', async () => {
    await writeFile(join(dir, 'pubspec.yaml'), 'name: demo\nflutter:\n');
    await mkdir(join(dir, 'integration_test'), { recursive: true });
    await writeFile(
      join(dir, 'integration_test', 'login_test.dart'),
      `patrolTest('login flow', (\$) async {}, tags: ['smoke']);`,
    );
    const ctx = makeCtx();
    const out = (await listTestsTool.handler({ projectRoot: dir }, ctx)) as {
      packageName: string | null;
      tests: { file: string; testNames: string[]; tags: string[] }[];
    };
    expect(out.packageName).toBe('demo');
    expect(out.tests).toHaveLength(1);
    expect(out.tests[0]).toMatchObject({
      file: 'integration_test/login_test.dart',
      testNames: ['login flow'],
      tags: ['smoke'],
    });
  });
});
