/**
 * Package dependency inspection tools:
 *
 *   read_package_uris  — resolve package: URIs to filesystem paths and read source
 *   grep_packages      — search within package dependency source code
 *
 * Fills the gap with dart_mcp_server's read_package_uris and rip_grep_packages.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err, errFromException } from '../runtime/result.js';
import { spawnCapture } from '../runtime/spawn.js';
import { loadProject } from '../util/project.js';

const rootArg = z
  .string()
  .min(1)
  .describe('Absolute path to a Flutter/Dart project root.');

interface PackageConfig {
  configVersion: number;
  packages: Array<{
    name: string;
    rootUri: string;
    packageUri?: string;
    languageVersion?: string;
  }>;
}

async function loadPackageConfig(projectRoot: string): Promise<PackageConfig> {
  const configPath = resolve(projectRoot, '.dart_tool', 'package_config.json');
  const raw = await readFile(configPath, 'utf8');
  return JSON.parse(raw) as PackageConfig;
}

function resolvePackageUri(
  config: PackageConfig,
  projectRoot: string,
  packageUri: string,
): { packageName: string; filePath: string } | null {
  const match = packageUri.match(/^package:([^/]+)\/(.+)$/);
  if (!match || !match[1] || !match[2]) return null;

  const packageName = match[1];
  const relPath = match[2];

  const pkg = config.packages.find((p) => p.name === packageName);
  if (!pkg) return null;

  const configDir = resolve(projectRoot, '.dart_tool');
  let pkgRoot: string;
  if (pkg.rootUri.startsWith('file://')) {
    pkgRoot = new URL(pkg.rootUri).pathname;
    if (process.platform === 'win32' && pkgRoot.startsWith('/')) {
      pkgRoot = pkgRoot.slice(1);
    }
  } else {
    pkgRoot = resolve(configDir, pkg.rootUri);
  }

  const libDir = pkg.packageUri
    ? resolve(pkgRoot, pkg.packageUri)
    : resolve(pkgRoot, 'lib');

  return { packageName, filePath: resolve(libDir, relPath) };
}

export function register(server: McpServer): void {
  defineTool<{ root: string; uris: string[]; maxLines?: number }>(server, {
    name: 'read_package_uris',
    description:
      'Resolve package: URIs (e.g. package:provider/provider.dart) to filesystem paths ' +
      'and return their source code. Uses .dart_tool/package_config.json for resolution. ' +
      'Run pub_get first if package_config.json is missing.',
    inputSchema: {
      root: rootArg,
      uris: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .describe('package: URIs to resolve and read (max 20).'),
      maxLines: z
        .number()
        .int()
        .positive()
        .optional()
        .default(500)
        .describe('Max lines to return per file. Default 500.'),
    },
    watchdog: { name: 'read_package_uris', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root, uris, maxLines }) => {
      try {
        const proj = loadProject(root);
        const config = await loadPackageConfig(proj.root);

        const results: Array<{
          uri: string;
          resolved: boolean;
          filePath?: string;
          packageName?: string;
          content?: string;
          lineCount?: number;
          truncated?: boolean;
          error?: string;
        }> = [];

        for (const uri of uris) {
          const resolved = resolvePackageUri(config, proj.root, uri);
          if (!resolved) {
            results.push({ uri, resolved: false, error: `Package not found in package_config.json` });
            continue;
          }
          try {
            const raw = await readFile(resolved.filePath, 'utf8');
            const lines = raw.split('\n');
            const linesLimit = maxLines ?? 500;
            const truncated = lines.length > linesLimit;
            const content = truncated ? lines.slice(0, linesLimit).join('\n') : raw;
            results.push({
              uri,
              resolved: true,
              filePath: resolved.filePath,
              packageName: resolved.packageName,
              content,
              lineCount: lines.length,
              truncated,
            });
          } catch (readErr) {
            results.push({
              uri,
              resolved: true,
              filePath: resolved.filePath,
              packageName: resolved.packageName,
              error: `File not readable: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
            });
          }
        }

        return okJson({
          availablePackages: config.packages.map((p) => p.name),
          results,
        });
      } catch (e) {
        return errFromException(
          e,
          'Ensure .dart_tool/package_config.json exists (run pub_get first).',
        );
      }
    },
  });

  defineTool<{ root: string; pattern: string; packages?: string[]; maxResults?: number }>(server, {
    name: 'grep_packages',
    description:
      'Search within package dependency source code using ripgrep. ' +
      'Resolves package paths from .dart_tool/package_config.json and greps their lib/ directories. ' +
      'Useful for finding type definitions, API usage patterns, or tracing imports in dependencies.',
    inputSchema: {
      root: rootArg,
      pattern: z.string().min(1).describe('Regex pattern to search for (ripgrep syntax).'),
      packages: z
        .array(z.string().min(1))
        .optional()
        .describe('Filter to specific package names. Omit to search all dependencies.'),
      maxResults: z
        .number()
        .int()
        .positive()
        .optional()
        .default(100)
        .describe('Max matching lines to return. Default 100.'),
    },
    watchdog: { name: 'grep_packages', ceilingMs: 60_000, toolClass: 'long' },
    handler: async ({ root, pattern, packages: packageFilter, maxResults }, ctx) => {
      try {
        const proj = loadProject(root);
        const config = await loadPackageConfig(proj.root);
        const configDir = resolve(proj.root, '.dart_tool');

        const searchDirs: Array<{ name: string; dir: string }> = [];
        for (const pkg of config.packages) {
          if (packageFilter && !packageFilter.includes(pkg.name)) continue;

          let pkgRoot: string;
          if (pkg.rootUri.startsWith('file://')) {
            pkgRoot = new URL(pkg.rootUri).pathname;
            if (process.platform === 'win32' && pkgRoot.startsWith('/')) {
              pkgRoot = pkgRoot.slice(1);
            }
          } else {
            pkgRoot = resolve(configDir, pkg.rootUri);
          }

          const libDir = pkg.packageUri
            ? resolve(pkgRoot, pkg.packageUri)
            : resolve(pkgRoot, 'lib');

          searchDirs.push({ name: pkg.name, dir: libDir });
        }

        if (searchDirs.length === 0) {
          return err('No matching packages found in package_config.json.');
        }

        const limit = maxResults ?? 100;
        const allMatches: Array<{
          package: string;
          file: string;
          line: number;
          content: string;
        }> = [];

        for (const { name, dir } of searchDirs) {
          if (allMatches.length >= limit) break;
          const remaining = limit - allMatches.length;

          const rgBin = process.platform === 'win32' ? 'rg.exe' : 'rg';
          const result = await spawnCapture({
            cmd: rgBin,
            args: [
              '--no-heading',
              '--line-number',
              '--max-count', String(remaining),
              '--type', 'dart',
              pattern,
              dir,
            ],
            cwd: dir,
            timeoutMs: 15_000,
            signal: ctx.signal,
          });

          if (result.stdout.trim()) {
            for (const line of result.stdout.split('\n')) {
              if (!line.trim()) continue;
              const match = line.match(/^(.+?):(\d+):(.*)$/);
              if (match && match[1] && match[2] && match[3] !== undefined) {
                allMatches.push({
                  package: name,
                  file: match[1],
                  line: Number(match[2]),
                  content: match[3],
                });
              }
            }
          }
        }

        return okJson({
          pattern,
          packagesSearched: searchDirs.length,
          totalMatches: allMatches.length,
          truncated: allMatches.length >= limit,
          matches: allMatches.slice(0, limit),
        });
      } catch (e) {
        return errFromException(
          e,
          'Ensure .dart_tool/package_config.json exists and ripgrep (rg) is installed.',
        );
      }
    },
  });
}
