/**
 * Project discovery + pubspec.yaml IO.
 *
 * Tools accept a `root: string` (absolute path). We walk upward looking for
 * pubspec.yaml; the first ancestor that has one is the project root used for
 * `dart`/`flutter` invocations. Failure raises ProjectNotFoundError so the
 * tool reports a useful message rather than running CLI from a wrong cwd.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse as yamlParse, parseDocument, stringify as yamlStringify } from 'yaml';
import { ProjectNotFoundError } from '../runtime/errors.js';

export interface PubspecMin {
  name: string;
  description?: string;
  version?: string;
  environment?: Record<string, string | undefined>;
  dependencies?: Record<string, unknown>;
  dev_dependencies?: Record<string, unknown>;
  dependency_overrides?: Record<string, unknown>;
  flutter?: Record<string, unknown>;
}

export interface ProjectInfo {
  root: string;
  pubspecPath: string;
  isFlutter: boolean;
  pubspec: PubspecMin;
}

export function normalizeRoot(input: string): string {
  if (!isAbsolute(input)) {
    throw new Error(`Project root must be an absolute path; got '${input}'.`);
  }
  return resolve(input);
}

/** Walk upward until a pubspec.yaml is found, or throw. */
export function findProjectRoot(start: string): string {
  let cur = normalizeRoot(start);
  // If `start` is a file, begin from its dirname.
  try {
    const s = statSync(cur);
    if (!s.isDirectory()) cur = dirname(cur);
  } catch {
    // start may not exist; let later filesystem ops error out.
  }
  // Walk up to filesystem root.
  for (;;) {
    const candidate = join(cur, 'pubspec.yaml');
    if (existsSync(candidate)) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new ProjectNotFoundError(start);
}

export function readPubspec(root: string): PubspecMin {
  const path = join(root, 'pubspec.yaml');
  const raw = readFileSync(path, 'utf8');
  const parsed = yamlParse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid pubspec.yaml at ${path}: not a YAML map.`);
  }
  return parsed as PubspecMin;
}

export function loadProject(start: string): ProjectInfo {
  const root = findProjectRoot(start);
  const pubspec = readPubspec(root);
  const isFlutter = Boolean(
    pubspec.flutter ||
    (pubspec.dependencies && 'flutter' in pubspec.dependencies) ||
    (pubspec.dev_dependencies && 'flutter_test' in pubspec.dev_dependencies),
  );
  return {
    root,
    pubspecPath: join(root, 'pubspec.yaml'),
    isFlutter,
    pubspec,
  };
}

/**
 * Edit pubspec.yaml preserving comments and ordering via yaml's Document API.
 * `mutator` receives a parsed Document and may mutate it in-place. The
 * resulting bytes are written back atomically.
 */
export function editPubspec(
  root: string,
  mutator: (doc: ReturnType<typeof parseDocument>) => void,
): void {
  const path = join(root, 'pubspec.yaml');
  const raw = readFileSync(path, 'utf8');
  const doc = parseDocument(raw);
  mutator(doc);
  const next = String(doc);
  writeFileSync(path, next, 'utf8');
}

export function stringifyYaml(value: unknown): string {
  return yamlStringify(value);
}
