/**
 * Asset management tools (plan §5.1 — Asset management):
 *
 *   add_asset           — copy file into assets/, register in pubspec, run pub get
 *   validate_assets     — verify all pubspec-registered assets exist
 *   list_orphan_assets  — files in assets/ NOT referenced by pubspec
 *
 * pubspec asset entry can be a file path ("assets/img/logo.png") or a folder
 * with trailing slash ("assets/icons/"). We resolve both.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err, errFromException } from '../runtime/result.js';
import { spawnCapture } from '../runtime/spawn.js';
import { resolveCli } from '../util/cli.js';
import { editPubspec, loadProject, type PubspecMin } from '../util/project.js';

const rootArg = z.string().min(1).describe('Absolute path to a Flutter project root.');

function listPubspecAssets(pub: PubspecMin): string[] {
  const flutter = pub.flutter ?? {};
  const assets = (flutter as { assets?: Array<string | { path?: string }> })['assets'] ?? [];
  return assets
    .map((a) => (typeof a === 'string' ? a : ((a as { path?: string })?.path ?? '')))
    .filter((s) => s.length > 0);
}

function expandAssetEntries(
  root: string,
  entries: string[],
): { existing: string[]; missing: string[] } {
  const existing: string[] = [];
  const missing: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry);
    if (entry.endsWith('/') || entry.endsWith('\\')) {
      if (!existsSync(full) || !statSync(full).isDirectory()) {
        missing.push(entry);
        continue;
      }
      for (const f of readdirSync(full)) {
        const fpath = join(full, f);
        if (statSync(fpath).isFile()) existing.push(relative(root, fpath).replace(/\\/g, '/'));
      }
    } else {
      if (existsSync(full)) existing.push(entry);
      else missing.push(entry);
    }
  }
  return { existing, missing };
}

function walkAllAssets(root: string): string[] {
  const dir = join(root, 'assets');
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(full);
      else if (s.isFile()) out.push(relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(dir);
  return out;
}

export function register(server: McpServer): void {
  defineTool<{ root: string; source: string; destination: string; runGet?: boolean }>(server, {
    name: 'add_asset',
    description:
      'Copy a file into the project (typically assets/...), register it under flutter.assets in pubspec, and run pub get. Source can be an absolute path or relative to project root.',
    inputSchema: {
      root: rootArg,
      source: z.string().min(1).describe('Source file path; absolute or relative to project root.'),
      destination: z
        .string()
        .min(1)
        .regex(
          /^(assets\/|images\/|fonts\/)/,
          'Destination should live under assets/, images/, or fonts/.',
        )
        .describe('Destination path relative to project root, e.g. assets/img/logo.png.'),
      runGet: z.boolean().optional().default(true),
    },
    watchdog: { name: 'add_asset', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root, source, destination, runGet }, ctx) => {
      try {
        const proj = loadProject(root);
        const sourceAbs = isAbsolute(source) ? source : join(proj.root, source);
        if (!existsSync(sourceAbs)) return err(`Source file not found: ${sourceAbs}`);
        const destAbs = join(proj.root, destination);
        mkdirSync(dirname(destAbs), { recursive: true });
        copyFileSync(sourceAbs, destAbs);
        editPubspec(proj.root, (doc) => {
          const flutter = doc.get('flutter');
          if (!flutter) {
            doc.set('flutter', { assets: [destination] });
            return;
          }
          // Get or create assets sequence.
          const assets = (
            flutter as { get: (k: string) => unknown; set: (k: string, v: unknown) => void }
          ).get('assets');
          if (!assets) {
            (flutter as { set: (k: string, v: unknown) => void }).set('assets', [destination]);
            return;
          }
          // yaml's YAMLSeq has add() method
          const seq = assets as { add: (v: unknown) => void; toJSON: () => unknown[] };
          const existing = (seq.toJSON?.() ?? []) as string[];
          if (!existing.includes(destination)) seq.add(destination);
        });
        let pubGetResult: { exitCode: number | null } | null = null;
        if (runGet) {
          const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
          const res = await spawnCapture({
            cmd: cli,
            args: ['pub', 'get'],
            cwd: proj.root,
            timeoutMs: 60_000,
            signal: ctx.signal,
          });
          pubGetResult = { exitCode: res.exitCode };
        }
        return okJson({ destination, sourceAbs, pubGet: pubGetResult });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'validate_assets',
    description:
      'Verify every flutter.assets entry in pubspec.yaml resolves to an existing file or non-empty directory.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'validate_assets', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root }) => {
      try {
        const proj = loadProject(root);
        const entries = listPubspecAssets(proj.pubspec);
        const { existing, missing } = expandAssetEntries(proj.root, entries);
        return okJson({
          totalEntries: entries.length,
          existingFiles: existing.length,
          missingEntries: missing,
          ok: missing.length === 0,
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'list_orphan_assets',
    description:
      'List files under assets/ that are NOT referenced (transitively) by any flutter.assets entry in pubspec.yaml.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'list_orphan_assets', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root }) => {
      try {
        const proj = loadProject(root);
        const entries = listPubspecAssets(proj.pubspec);
        const { existing } = expandAssetEntries(proj.root, entries);
        const allOnDisk = walkAllAssets(proj.root);
        const refSet = new Set(existing.map((p) => p.replace(/\\/g, '/')));
        const orphans = allOnDisk.filter((p) => !refSet.has(p)).sort();
        return okJson({ totalOnDisk: allOnDisk.length, totalReferenced: refSet.size, orphans });
      } catch (e) {
        return errFromException(e);
      }
    },
  });
}
