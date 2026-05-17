/**
 * Project meta tools: list_projects, project_info, list_flavors, list_dart_defines.
 *
 * `roots` is always an absolute-path array. We walk each root recursively
 * with a hard depth limit (default 4) looking for pubspec.yaml. Skips
 * node_modules, .dart_tool, .git, build directories.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson } from '../runtime/result.js';
import { loadProject, normalizeRoot, readPubspec } from '../util/project.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.dart_tool',
  '.git',
  'build',
  '.idea',
  '.vscode',
  'ios',
  'android',
  'macos',
  'windows',
  'linux',
  'web',
]);

function findPubspecs(root: string, maxDepth = 4): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes('pubspec.yaml')) {
      out.push(dir);
      // Don't descend into a pubspec's lib/ etc.; sub-packages are rare and the
      // depth cap handles those that exist.
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export function register(server: McpServer): void {
  defineTool<{ roots: string[]; maxDepth?: number }>(server, {
    name: 'list_projects',
    description:
      'Enumerate Flutter/Dart projects found under each root. Returns absolute path, package name, and whether the project depends on Flutter.',
    inputSchema: {
      roots: z.array(z.string().min(1)).min(1).describe('Absolute filesystem paths to search.'),
      maxDepth: z.number().int().min(1).max(8).optional().default(4),
    },
    watchdog: { name: 'list_projects', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ roots, maxDepth }) => {
      const seen = new Set<string>();
      const projects: Array<{ root: string; name: string; isFlutter: boolean; version?: string }> =
        [];
      for (const r of roots) {
        const normalized = normalizeRoot(r);
        if (!existsSync(normalized)) continue;
        for (const projRoot of findPubspecs(normalized, maxDepth ?? 4)) {
          if (seen.has(projRoot)) continue;
          seen.add(projRoot);
          try {
            const pub = readPubspec(projRoot);
            const isFlutter = Boolean(
              pub.flutter ||
              (pub.dependencies && 'flutter' in pub.dependencies) ||
              (pub.dev_dependencies && 'flutter_test' in pub.dev_dependencies),
            );
            projects.push({
              root: projRoot,
              name: pub.name,
              isFlutter,
              ...(pub.version !== undefined ? { version: pub.version } : {}),
            });
          } catch {
            // skip invalid pubspec.yaml
          }
        }
      }
      return okJson({ projects });
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'project_info',
    description:
      'Detailed info for the Flutter/Dart project rooted at the given path: Flutter version constraint, dependencies, build config, entrypoints, flavors, dart-defines from launch.json.',
    inputSchema: {
      root: z.string().min(1).describe('Absolute path to a project root or any descendant.'),
    },
    watchdog: { name: 'project_info', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root }) => {
      const proj = loadProject(root);
      const entrypoints = enumerateEntrypoints(proj.root);
      const flavors = detectFlavors(proj.root);
      const dartDefines = detectDartDefines(proj.root);
      return okJson({
        root: proj.root,
        pubspecPath: proj.pubspecPath,
        name: proj.pubspec.name,
        version: proj.pubspec.version,
        description: proj.pubspec.description,
        isFlutter: proj.isFlutter,
        environment: proj.pubspec.environment ?? {},
        dependencies: proj.pubspec.dependencies ?? {},
        devDependencies: proj.pubspec.dev_dependencies ?? {},
        dependencyOverrides: proj.pubspec.dependency_overrides ?? {},
        flutterSection: proj.pubspec.flutter ?? {},
        entrypoints,
        flavors,
        dartDefines,
      });
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'list_flavors',
    description:
      'Detect Flutter flavors declared in android/app/build.gradle, android/app/build.gradle.kts, and ios/Runner.xcodeproj. Returns flavor names + target mappings.',
    inputSchema: {
      root: z.string().min(1),
    },
    watchdog: { name: 'list_flavors', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root }) => {
      const proj = loadProject(root);
      return okJson({ flavors: detectFlavors(proj.root) });
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'list_dart_defines',
    description:
      'Scan .vscode/launch.json and lib/main_*.dart for --dart-define keys. Returns unique key set + per-launch-config values.',
    inputSchema: {
      root: z.string().min(1),
    },
    watchdog: { name: 'list_dart_defines', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root }) => {
      const proj = loadProject(root);
      return okJson({ dartDefines: detectDartDefines(proj.root) });
    },
  });
}

function enumerateEntrypoints(root: string): string[] {
  const libDir = join(root, 'lib');
  if (!existsSync(libDir)) return [];
  const out: string[] = [];
  for (const f of readdirSync(libDir)) {
    if (extname(f) !== '.dart') continue;
    if (f === 'main.dart' || f.startsWith('main_')) out.push(join('lib', f));
  }
  return out.sort();
}

interface FlavorInfo {
  source: 'android-gradle' | 'android-gradle-kts' | 'ios-xcconfig';
  name: string;
}

function detectFlavors(root: string): FlavorInfo[] {
  const out: FlavorInfo[] = [];
  const gradlePaths = [
    join(root, 'android', 'app', 'build.gradle'),
    join(root, 'android', 'app', 'build.gradle.kts'),
  ];
  for (const p of gradlePaths) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, 'utf8');
    const source: FlavorInfo['source'] = p.endsWith('.kts')
      ? 'android-gradle-kts'
      : 'android-gradle';
    // Naive: capture productFlavors blocks' immediate child identifiers.
    const block = raw.match(/productFlavors\s*\{([\s\S]*?)\n\s*\}/);
    if (block) {
      const inner = block[1] ?? '';
      const names = inner.matchAll(/\n\s*(?:create\(\s*"([\w-]+)"|([\w-]+)\s*\{)/g);
      for (const m of names) {
        const name = m[1] ?? m[2];
        if (name) out.push({ source, name });
      }
    }
  }
  // iOS xcconfig
  const iosFlavors = join(root, 'ios', 'Flutter');
  if (existsSync(iosFlavors)) {
    for (const f of readdirSync(iosFlavors)) {
      if (
        f.endsWith('.xcconfig') &&
        f !== 'Debug.xcconfig' &&
        f !== 'Release.xcconfig' &&
        f !== 'Generated.xcconfig'
      ) {
        out.push({ source: 'ios-xcconfig', name: f.replace(/\.xcconfig$/, '') });
      }
    }
  }
  return out;
}

interface DartDefineConfig {
  source: string;
  name: string;
  keys: Record<string, string>;
}

function detectDartDefines(root: string): DartDefineConfig[] {
  const out: DartDefineConfig[] = [];
  const launchPath = join(root, '.vscode', 'launch.json');
  if (existsSync(launchPath)) {
    try {
      const raw = readFileSync(launchPath, 'utf8');
      // Strip /* */ and // comments before JSON.parse — VSCode tolerates them.
      const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const parsed = JSON.parse(stripped) as { configurations?: Array<Record<string, unknown>> };
      for (const cfg of parsed.configurations ?? []) {
        if (cfg['type'] !== 'dart') continue;
        const name = String(cfg['name'] ?? '');
        const args = (cfg['args'] as string[] | undefined) ?? [];
        const keys: Record<string, string> = {};
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (typeof a !== 'string') continue;
          if (a === '--dart-define' && typeof args[i + 1] === 'string') {
            const kv = args[i + 1] as string;
            const eq = kv.indexOf('=');
            if (eq > 0) keys[kv.slice(0, eq)] = kv.slice(eq + 1);
            i++;
          } else if (a.startsWith('--dart-define=')) {
            const kv = a.slice('--dart-define='.length);
            const eq = kv.indexOf('=');
            if (eq > 0) keys[kv.slice(0, eq)] = kv.slice(eq + 1);
          }
        }
        const toolArgs = cfg['toolArgs'] as string[] | undefined;
        for (let i = 0; i < (toolArgs?.length ?? 0); i++) {
          const a = toolArgs?.[i];
          if (typeof a !== 'string') continue;
          if (a.startsWith('--dart-define=')) {
            const kv = a.slice('--dart-define='.length);
            const eq = kv.indexOf('=');
            if (eq > 0) keys[kv.slice(0, eq)] = kv.slice(eq + 1);
          }
        }
        if (Object.keys(keys).length > 0) {
          out.push({ source: '.vscode/launch.json', name, keys });
        }
      }
    } catch {
      // ignore parse errors
    }
  }
  return out;
}
