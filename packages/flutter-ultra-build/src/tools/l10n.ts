/**
 * l10n / ARB workflow tools (plan §5.1 — l10n / ARB workflows):
 *
 *   list_missing_translations — keys present in base ARB but missing per locale
 *   arb_diff                   — added/removed/changed keys between two ARBs
 *   arb_add_key                — add a key to ALL locale ARBs atomically
 *   arb_remove_key             — remove a key from ALL locale ARBs atomically
 *
 * Reads l10n.yaml for arb-dir / template-arb-file. Falls back to lib/l10n/
 * and app_en.arb when l10n.yaml absent.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, errFromException } from '../runtime/result.js';
import { loadProject } from '../util/project.js';

const rootArg = z.string().min(1).describe('Absolute path to a Flutter project root.');

interface L10nConfig {
  arbDir: string;
  templateArbFile: string;
}

function readL10nConfig(root: string): L10nConfig {
  const cfgPath = join(root, 'l10n.yaml');
  if (existsSync(cfgPath)) {
    const raw = readFileSync(cfgPath, 'utf8');
    // l10n.yaml is small; cheap parse.
    const arbDirMatch = raw.match(/arb-dir:\s*['"]?([^'"\n]+)['"]?/);
    const templateMatch = raw.match(/template-arb-file:\s*['"]?([^'"\n]+)['"]?/);
    return {
      arbDir: arbDirMatch?.[1]?.trim() ?? 'lib/l10n',
      templateArbFile: templateMatch?.[1]?.trim() ?? 'app_en.arb',
    };
  }
  return { arbDir: 'lib/l10n', templateArbFile: 'app_en.arb' };
}

function loadArb(root: string, cfg: L10nConfig, file: string): Record<string, unknown> {
  const path = join(root, cfg.arbDir, file);
  if (!existsSync(path)) throw new Error(`ARB file not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function listArbFiles(root: string, cfg: L10nConfig): string[] {
  const dir = join(root, cfg.arbDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.arb'));
}

function dataKeys(arb: Record<string, unknown>): string[] {
  return Object.keys(arb).filter((k) => !k.startsWith('@'));
}

export function register(server: McpServer): void {
  defineTool<{ root: string }>(server, {
    name: 'list_missing_translations',
    description:
      'For each locale ARB, list keys present in the template (base) ARB but missing in target.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'list_missing_translations', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root }) => {
      try {
        const proj = loadProject(root);
        const cfg = readL10nConfig(proj.root);
        const baseArb = loadArb(proj.root, cfg, cfg.templateArbFile);
        const baseKeys = new Set(dataKeys(baseArb));
        const out: Array<{ file: string; missingKeys: string[] }> = [];
        for (const f of listArbFiles(proj.root, cfg)) {
          if (f === cfg.templateArbFile) continue;
          try {
            const arb = loadArb(proj.root, cfg, f);
            const present = new Set(dataKeys(arb));
            const missing = [...baseKeys].filter((k) => !present.has(k));
            out.push({ file: f, missingKeys: missing.sort() });
          } catch {
            out.push({ file: f, missingKeys: [] });
          }
        }
        return okJson({ templateFile: cfg.templateArbFile, locales: out });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string; left: string; right: string }>(server, {
    name: 'arb_diff',
    description: 'Diff two ARBs in the project: added/removed/changed keys.',
    inputSchema: {
      root: rootArg,
      left: z.string().min(1).describe('Filename within arb-dir, e.g. app_en.arb.'),
      right: z.string().min(1).describe('Filename within arb-dir, e.g. app_ar.arb.'),
    },
    watchdog: { name: 'arb_diff', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root, left, right }) => {
      try {
        const proj = loadProject(root);
        const cfg = readL10nConfig(proj.root);
        const l = loadArb(proj.root, cfg, left);
        const r = loadArb(proj.root, cfg, right);
        const lKeys = new Set(dataKeys(l));
        const rKeys = new Set(dataKeys(r));
        const added = [...rKeys].filter((k) => !lKeys.has(k)).sort();
        const removed = [...lKeys].filter((k) => !rKeys.has(k)).sort();
        const changed: Array<{ key: string; left: unknown; right: unknown }> = [];
        for (const k of lKeys) {
          if (rKeys.has(k) && l[k] !== r[k]) changed.push({ key: k, left: l[k], right: r[k] });
        }
        return okJson({ left, right, added, removed, changed });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string; key: string; value: string; description?: string }>(server, {
    name: 'arb_add_key',
    description:
      'Add a key to ALL locale ARBs atomically. Value goes into the template (base) ARB; other locales get the same value as a placeholder fallback.',
    inputSchema: {
      root: rootArg,
      key: z
        .string()
        .min(1)
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Key must be a valid Dart identifier.'),
      value: z.string().min(1),
      description: z.string().optional(),
    },
    watchdog: { name: 'arb_add_key', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root, key, value, description }) => {
      try {
        const proj = loadProject(root);
        const cfg = readL10nConfig(proj.root);
        const files = listArbFiles(proj.root, cfg);
        const backups = new Map<string, string>();
        try {
          for (const f of files) {
            const path = join(proj.root, cfg.arbDir, f);
            const raw = readFileSync(path, 'utf8');
            backups.set(path, raw);
            const arb = JSON.parse(raw) as Record<string, unknown>;
            if (!(key in arb)) {
              arb[key] = value;
              if (f === cfg.templateArbFile && description) arb[`@${key}`] = { description };
              writeFileSync(path, JSON.stringify(arb, null, 2) + '\n', 'utf8');
            }
          }
        } catch (e) {
          for (const [path, content] of backups) writeFileSync(path, content, 'utf8');
          throw e;
        }
        return okJson({ key, files: files.length });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string; key: string }>(server, {
    name: 'arb_remove_key',
    description: 'Remove a key (and its metadata @key) from ALL locale ARBs atomically.',
    inputSchema: {
      root: rootArg,
      key: z.string().min(1),
    },
    watchdog: { name: 'arb_remove_key', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root, key }) => {
      try {
        const proj = loadProject(root);
        const cfg = readL10nConfig(proj.root);
        const files = listArbFiles(proj.root, cfg);
        const backups = new Map<string, string>();
        try {
          for (const f of files) {
            const path = join(proj.root, cfg.arbDir, f);
            const raw = readFileSync(path, 'utf8');
            backups.set(path, raw);
            const arb = JSON.parse(raw) as Record<string, unknown>;
            delete arb[key];
            delete arb[`@${key}`];
            writeFileSync(path, JSON.stringify(arb, null, 2) + '\n', 'utf8');
          }
        } catch (e) {
          for (const [path, content] of backups) writeFileSync(path, content, 'utf8');
          throw e;
        }
        return okJson({ removed: key, files: files.length });
      } catch (e) {
        return errFromException(e);
      }
    },
  });
}
