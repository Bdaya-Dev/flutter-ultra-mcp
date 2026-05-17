import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  editPubspec,
  findProjectRoot,
  loadProject,
  normalizeRoot,
  readPubspec,
} from './project.js';
import { ProjectNotFoundError } from '../runtime/errors.js';

function makeTmpProject(content: string): string {
  const root = mkdtempSync(join(tmpdir(), 'flutter-ultra-test-'));
  writeFileSync(join(root, 'pubspec.yaml'), content, 'utf8');
  return root;
}

describe('util/project', () => {
  it('normalizes absolute paths', () => {
    const root = tmpdir();
    expect(normalizeRoot(root)).toBeTruthy();
    expect(() => normalizeRoot('./relative')).toThrow(/absolute/);
  });

  it('finds the project root by walking upward', () => {
    const root = makeTmpProject('name: foo\n');
    try {
      const sub = join(root, 'nested', 'deeper');
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, 'sentinel.txt'), 'x');
      expect(findProjectRoot(sub)).toBe(root);
      expect(findProjectRoot(root)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws ProjectNotFoundError outside any pubspec tree', () => {
    const empty = mkdtempSync(join(tmpdir(), 'flutter-ultra-empty-'));
    try {
      // On Windows the walk may eventually find a pubspec somewhere; use a deep
      // newly-created directory tree to make this stable.
      expect(() => findProjectRoot(join(empty, 'a', 'b', 'c'))).toThrow(ProjectNotFoundError);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('reads + identifies a Flutter project', () => {
    const root = makeTmpProject(
      'name: testapp\nversion: 1.2.3\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\nflutter:\n  uses-material-design: true\n',
    );
    try {
      const info = loadProject(root);
      expect(info.root).toBe(root);
      expect(info.pubspec.name).toBe('testapp');
      expect(info.pubspec.version).toBe('1.2.3');
      expect(info.isFlutter).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('identifies a non-Flutter Dart package', () => {
    const root = makeTmpProject('name: pure_dart\ndependencies:\n  http: ^1.0.0\n');
    try {
      const info = loadProject(root);
      expect(info.isFlutter).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('editPubspec preserves comments when mutating', () => {
    const root = makeTmpProject(
      '# top comment\nname: foo\nversion: 1.0.0\ndependencies:\n  # comment before http\n  http: ^1.0.0\n',
    );
    try {
      editPubspec(root, (doc) => {
        doc.set('version', '2.0.0');
      });
      const raw = readPubspec(root);
      expect(raw.version).toBe('2.0.0');
      // Comments preserved by yaml's Document API:
      const text = readFileSync(join(root, 'pubspec.yaml'), 'utf8');
      expect(text).toMatch(/# top comment/);
      expect(text).toMatch(/# comment before http/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
