// Patrol test discovery — pure regex-walk over .dart test files.
//
// We deliberately avoid running `dart analyze` or shelling out to
// patrol_cli for this: the agent calls list_tests *often* (e.g. before
// every test run to pick a single test by name) so a sub-100ms scan
// matters more than perfect Dart semantics. We match the on-disk
// conventions Patrol itself relies on:
//   - patrolTest('name', ...)
//   - patrolWidgetTest('name', ...)
//   - testWidgets('name', ...)         // mostly seen in adjacent files
//   - group('name', () { ... });       // test prefix
// and surface tags from `tags:` argument when present.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface DiscoveredTest {
  /** Project-relative path to the .dart file. */
  file: string;
  /** Discovered test_name string literals at any nesting depth. */
  testNames: string[];
  /** Discovered tags across all tests in the file (deduped). */
  tags: string[];
}

const TEST_NAME_REGEX =
  /(?:patrolTest|patrolWidgetTest|testWidgets|test)\s*\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
const TAGS_REGEX = /tags\s*:\s*\[([^\]]*)\]/g;

/**
 * Walk one or more test directories, returning per-file test metadata.
 *
 * @param projectRoot Absolute path to the Flutter project root.
 * @param dirs Absolute paths under {@link projectRoot} to walk.
 */
export async function discoverTests(
  projectRoot: string,
  dirs: string[],
): Promise<DiscoveredTest[]> {
  const out: DiscoveredTest[] = [];
  for (const dir of dirs) {
    await walk(dir, async (absPath) => {
      if (!absPath.endsWith('_test.dart')) return;
      const source = await readFile(absPath, 'utf8');
      const meta = extractTestMetadata(source);
      if (meta.testNames.length === 0) return;
      out.push({
        file: toForwardSlash(relative(projectRoot, absPath)),
        testNames: meta.testNames,
        tags: meta.tags,
      });
    });
  }
  // Stable sort by file path so list_tests is deterministic for clients
  // that diff outputs across calls.
  out.sort((a, b) => a.file.localeCompare(b.file));
  return out;
}

export interface ExtractedTestMetadata {
  testNames: string[];
  tags: string[];
}

export function extractTestMetadata(source: string): ExtractedTestMetadata {
  const testNames: string[] = [];
  for (const m of source.matchAll(TEST_NAME_REGEX)) {
    const name = m[2];
    if (name && !testNames.includes(name)) testNames.push(name);
  }
  const tagSet = new Set<string>();
  for (const m of source.matchAll(TAGS_REGEX)) {
    const body = m[1] ?? '';
    for (const lit of body.matchAll(/['"]([^'"]+)['"]/g)) {
      const tag = lit[1];
      if (tag) tagSet.add(tag);
    }
  }
  return { testNames, tags: Array.from(tagSet).sort() };
}

async function walk(dir: string, visit: (absPath: string) => Promise<void>): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // dir does not exist — caller already filtered, but be lenient
  }
  for (const name of entries) {
    // Skip generated bundle file and hidden dirs.
    if (name.startsWith('.') || name === 'test_bundle.dart') continue;
    const abs = join(dir, name);
    const st = await stat(abs);
    if (st.isDirectory()) {
      await walk(abs, visit);
    } else if (st.isFile()) {
      await visit(abs);
    }
  }
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}
