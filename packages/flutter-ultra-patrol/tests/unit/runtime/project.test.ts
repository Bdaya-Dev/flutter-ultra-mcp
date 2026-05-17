import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findFlutterProject, locateTestDirectories } from '../../../src/runtime/project.js';

describe('findFlutterProject', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'patrol-proj-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('throws when start is not absolute', () => {
    expect(() => findFlutterProject('relative/path')).toThrow(/start must be absolute/);
  });

  it('locates the project containing pubspec.yaml at the start dir', async () => {
    await writeFile(
      join(dir, 'pubspec.yaml'),
      'name: demo\nflutter:\n  uses-material-design: true\n',
    );
    const got = findFlutterProject(dir);
    expect(got.root).toBe(dir);
    expect(got.packageName).toBe('demo');
    expect(got.isFlutter).toBe(true);
  });

  it('walks upward to find pubspec.yaml', async () => {
    await writeFile(join(dir, 'pubspec.yaml'), 'name: demo\n');
    const child = join(dir, 'a', 'b', 'c');
    await mkdir(child, { recursive: true });
    const got = findFlutterProject(child);
    expect(got.root).toBe(dir);
  });

  it('throws when no pubspec.yaml is reachable', async () => {
    const child = join(dir, 'a', 'b');
    await mkdir(child, { recursive: true });
    expect(() => findFlutterProject(child)).toThrow(/no pubspec\.yaml/);
  });
});

describe('locateTestDirectories', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'patrol-tests-dir-'));
    await writeFile(join(dir, 'pubspec.yaml'), 'name: demo\n');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns only directories that exist', async () => {
    await mkdir(join(dir, 'integration_test'));
    const project = findFlutterProject(dir);
    const dirs = locateTestDirectories(project);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(dir, 'integration_test'));
  });

  it('surfaces both integration_test and patrol_test when both exist', async () => {
    await mkdir(join(dir, 'integration_test'));
    await mkdir(join(dir, 'patrol_test'));
    const project = findFlutterProject(dir);
    const dirs = locateTestDirectories(project);
    expect(dirs).toHaveLength(2);
  });

  it('returns empty when neither exists', () => {
    const project = findFlutterProject(dir);
    expect(locateTestDirectories(project)).toEqual([]);
  });
});
