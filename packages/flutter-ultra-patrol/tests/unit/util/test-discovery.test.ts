import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverTests, extractTestMetadata } from '../../../src/util/test-discovery.js';

describe('extractTestMetadata', () => {
  it('extracts patrolTest names', () => {
    const got = extractTestMetadata(`
      void main() {
        patrolTest('logs in OK', (\$) async {});
        patrolTest("renders dashboard", (\$) async {});
      }
    `);
    expect(got.testNames).toEqual(['logs in OK', 'renders dashboard']);
  });

  it('extracts patrolWidgetTest and testWidgets names', () => {
    const got = extractTestMetadata(`
      patrolWidgetTest('renders empty state', (tester) async {});
      testWidgets('handles error', (tester) async {});
    `);
    expect(got.testNames).toEqual(['renders empty state', 'handles error']);
  });

  it('dedupes repeated names', () => {
    const got = extractTestMetadata(`
      patrolTest('same', (\$) async {});
      patrolTest('same', (\$) async {});
    `);
    expect(got.testNames).toEqual(['same']);
  });

  it('extracts tags from tags: [...] arguments', () => {
    const got = extractTestMetadata(`
      patrolTest('a', (\$) async {}, tags: ['smoke', 'auth']);
      patrolTest('b', (\$) async {}, tags: ["smoke"]);
    `);
    expect(got.tags).toEqual(['auth', 'smoke']);
  });

  it('returns empty arrays for source with no tests', () => {
    expect(extractTestMetadata('void main() {}')).toEqual({
      testNames: [],
      tags: [],
    });
  });
});

describe('discoverTests', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'patrol-disco-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns sorted test files with their names', async () => {
    const itd = join(dir, 'integration_test');
    await mkdir(itd, { recursive: true });
    await writeFile(join(itd, 'b_test.dart'), `patrolTest('beta', (\$) async {});`);
    await writeFile(join(itd, 'a_test.dart'), `patrolTest('alpha', (\$) async {});`);
    const got = await discoverTests(dir, [itd]);
    expect(got.map((t) => t.file)).toEqual([
      'integration_test/a_test.dart',
      'integration_test/b_test.dart',
    ]);
    expect(got[0]!.testNames).toEqual(['alpha']);
  });

  it('skips files that do not match *_test.dart', async () => {
    const itd = join(dir, 'integration_test');
    await mkdir(itd, { recursive: true });
    await writeFile(join(itd, 'helpers.dart'), `patrolTest('not a test file', (\$) async {});`);
    expect(await discoverTests(dir, [itd])).toEqual([]);
  });

  it('walks subdirectories', async () => {
    const sub = join(dir, 'integration_test', 'flows');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'login_test.dart'), `patrolTest('login flow', (\$) async {});`);
    const got = await discoverTests(dir, [join(dir, 'integration_test')]);
    expect(got[0]!.file).toBe('integration_test/flows/login_test.dart');
  });

  it('skips generated test_bundle.dart', async () => {
    const itd = join(dir, 'integration_test');
    await mkdir(itd, { recursive: true });
    await writeFile(
      join(itd, 'test_bundle.dart'),
      `patrolTest('should be skipped', (\$) async {});`,
    );
    expect(await discoverTests(dir, [itd])).toEqual([]);
  });
});
