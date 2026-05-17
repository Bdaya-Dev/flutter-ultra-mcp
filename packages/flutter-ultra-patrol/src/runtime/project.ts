// Flutter project root detection.
//
// Patrol invariably runs from the directory containing the Flutter app's
// pubspec.yaml. The MCP client passes a workingDir hint per call; we walk
// upward to find the pubspec to allow callers to point at sub-directories.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export interface FlutterProject {
  /** Absolute path to the directory containing pubspec.yaml. */
  root: string;
  /** Parsed `name:` from pubspec.yaml — informational only. */
  packageName: string | null;
  /** True if pubspec declares a `flutter:` block. */
  isFlutter: boolean;
}

const MAX_WALK = 8;

/**
 * Resolves a Flutter project root from a starting directory hint. Walks up
 * to MAX_WALK parent directories looking for pubspec.yaml. Throws if none
 * is found — patrol_cli requires it.
 *
 * Relative `start` paths are resolved against `process.cwd()` by caller
 * convention (we don't reach into process here so tests can inject any
 * starting point).
 */
export function findFlutterProject(start: string): FlutterProject {
  if (!isAbsolute(start)) {
    throw new Error(`findFlutterProject: start must be absolute, got "${start}"`);
  }
  let cur = start;
  for (let i = 0; i <= MAX_WALK; i++) {
    const candidate = resolve(cur, 'pubspec.yaml');
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, 'utf8');
      return {
        root: cur,
        packageName: parsePubspecName(content),
        isFlutter: /^\s*flutter\s*:/m.test(content),
      };
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(`findFlutterProject: no pubspec.yaml within ${MAX_WALK} parents of "${start}"`);
}

function parsePubspecName(content: string): string | null {
  const m = content.match(/^\s*name\s*:\s*(\S+)\s*$/m);
  return m ? (m[1] ?? null) : null;
}

/**
 * Returns absolute paths to test source directories that exist under the
 * project root. patrol_cli looks at the directory configured in
 * pubspec.yaml's `patrol.test_directory` (default `integration_test`); we
 * additionally surface `patrol_test/` because some Bdaya projects mirror
 * Patrol-Web-only suites there for parallel-run isolation.
 */
export function locateTestDirectories(project: FlutterProject): string[] {
  const candidates = ['integration_test', 'patrol_test'];
  const dirs: string[] = [];
  for (const c of candidates) {
    const abs = resolve(project.root, c);
    if (existsSync(abs)) dirs.push(abs);
  }
  return dirs;
}
