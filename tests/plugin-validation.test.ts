// Plugin validation suite — runs in CI (GitHub Actions) for free.
// No Claude auth or API costs. Pure filesystem + JSON/YAML checks.
//
// Validates:
//   1. .claude-plugin/plugin.json — manifest schema
//   2. .mcp.json — server declarations reference built artifacts
//   3. skills/*/SKILL.md — frontmatter (YAML), required fields, structure
//   4. Cross-reference: every MCP tool name in skills maps to a real server tool
//
// Run: npx vitest run tests/plugin-validation.test.ts

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

// ─── 1. plugin.json manifest ────────────────────────────────────────────────

describe('plugin.json manifest', () => {
  const manifestPath = join(ROOT, '.claude-plugin', 'plugin.json');

  it('exists at .claude-plugin/plugin.json', () => {
    expect(existsSync(manifestPath)).toBe(true);
  });

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  it('has required field: name', () => {
    expect(manifest.name).toBeTypeOf('string');
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  it('has required field: description', () => {
    expect(manifest.description).toBeTypeOf('string');
    expect(manifest.description.length).toBeGreaterThan(0);
  });

  it('name is a short slug (no spaces, plugin namespace prefix)', () => {
    expect(manifest.name).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('has author with name', () => {
    expect(manifest.author?.name).toBeTypeOf('string');
  });

  it('has valid license', () => {
    expect(manifest.license).toBeTypeOf('string');
  });

  if (manifest.version) {
    it('version is semver', () => {
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  }
});

// ─── 2. .mcp.json server declarations ───────────────────────────────────────

describe('.mcp.json server declarations', () => {
  const mcpPath = join(ROOT, '.mcp.json');

  it('exists at repo root', () => {
    expect(existsSync(mcpPath)).toBe(true);
  });

  const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf8'));

  it('has mcpServers object', () => {
    expect(mcpConfig.mcpServers).toBeTypeOf('object');
    expect(Object.keys(mcpConfig.mcpServers).length).toBeGreaterThan(0);
  });

  for (const [name, server] of Object.entries(mcpConfig.mcpServers) as [string, any][]) {
    describe(`server: ${name}`, () => {
      it('has command field', () => {
        expect(server.command).toBeTypeOf('string');
      });

      it('has args array', () => {
        expect(Array.isArray(server.args)).toBe(true);
        expect(server.args.length).toBeGreaterThan(0);
      });

      it('args reference ${CLAUDE_PLUGIN_ROOT}', () => {
        const argsJoined = server.args.join(' ');
        expect(argsJoined).toContain('${CLAUDE_PLUGIN_ROOT}');
      });

      it('built artifact exists (dist/bin.cjs or dist/index.js)', () => {
        const argPath = (server.args[0] as string)
          .replace('${CLAUDE_PLUGIN_ROOT}/', '')
          .replace('${CLAUDE_PLUGIN_ROOT}\\', '');
        const fullPath = join(ROOT, argPath);
        expect(existsSync(fullPath), `Missing: ${argPath}`).toBe(true);
      });
    });
  }
});

// ─── 3. SKILL.md frontmatter validation ─────────────────────────────────────

interface SkillFrontmatter {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;

  const yamlBlock = match[1]!;
  const body = match[2]!;
  const fm: SkillFrontmatter = {};

  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kv) {
      fm[kv[1]!] = kv[2]!.trim();
    }
  }

  return { frontmatter: fm, body };
}

describe('SKILL.md files', () => {
  const skillsDir = join(ROOT, 'skills');

  it('skills/ directory exists', () => {
    expect(existsSync(skillsDir)).toBe(true);
  });

  const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  it('has at least one skill', () => {
    expect(skillDirs.length).toBeGreaterThan(0);
  });

  const isInternal = (name: string): boolean => name.startsWith('_internal');

  for (const skillName of skillDirs) {
    describe(`skill: ${skillName}`, () => {
      const skillPath = join(skillsDir, skillName, 'SKILL.md');

      it('has SKILL.md', () => {
        expect(existsSync(skillPath), `Missing: skills/${skillName}/SKILL.md`).toBe(true);
      });

      const content = readFileSync(skillPath, 'utf8');
      const parsed = parseFrontmatter(content);

      it('has valid YAML frontmatter (--- delimiters)', () => {
        expect(parsed, `No frontmatter found in skills/${skillName}/SKILL.md`).not.toBeNull();
      });

      if (!parsed) return;

      // Internal hook-triggered skills are intentionally minimal — skip content checks.
      if (isInternal(skillName)) return;

      it('frontmatter has "description" field', () => {
        expect(
          parsed.frontmatter.description,
          `Missing 'description:' in skills/${skillName}/SKILL.md frontmatter`,
        ).toBeDefined();
        expect(parsed.frontmatter.description!.length).toBeGreaterThan(10);
      });

      it('body has substantive content (not a stub)', () => {
        const lineCount = parsed.body.split('\n').length;
        expect(
          lineCount,
          `skills/${skillName}/SKILL.md is only ${lineCount} lines — likely a stub`,
        ).toBeGreaterThan(20);
      });

      it('body contains at least one MCP tool reference or heading', () => {
        const hasTool = /mcp__plugin_flutter/.test(parsed.body);
        const hasHeading = /^##\s/m.test(parsed.body);
        expect(hasTool || hasHeading, 'No tool references or section headings found').toBe(true);
      });
    });
  }
});

// ─── 4. Cross-reference: skill tool refs → server tool names ────────────────

const TOOL_REF_PATTERN = /mcp__plugin_flutter_flutter-ultra-(\w+)__(\w+)/g;

interface ToolRef {
  server: string;
  tool: string;
  file: string;
  line: number;
}

function extractSkillToolRefs(): ToolRef[] {
  const skillsDir = join(ROOT, 'skills');
  const refs: ToolRef[] = [];

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsDir, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = readFileSync(skillFile, 'utf8');
    } catch {
      continue;
    }
    for (const [i, line] of content.split('\n').entries()) {
      for (const match of line.matchAll(TOOL_REF_PATTERN)) {
        refs.push({
          server: match[1]!.replace(/-/g, '_'),
          tool: match[2]!,
          file: `skills/${entry.name}/SKILL.md`,
          line: i + 1,
        });
      }
    }
  }
  return refs;
}

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
        results.push(...collectTsFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        results.push(full);
      }
    }
  } catch {
    /* directory doesn't exist */
  }
  return results;
}

const SERVER_TOOL_PATTERNS = [
  /name:\s*'([a-z][a-z0-9_]*?)'/g,
  /name:\s*"([a-z][a-z0-9_]*?)"/g,
  /\[\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\]/g,
];

function extractServerTools(): Map<string, Set<string>> {
  const packagesDir = join(ROOT, 'packages');
  const serverTools = new Map<string, Set<string>>();

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('flutter-ultra-')) continue;
    const serverKey = entry.name.replace(/^flutter-ultra-/, '').replace(/-/g, '_');
    const tools = new Set<string>();

    for (const tsFile of collectTsFiles(join(packagesDir, entry.name, 'src'))) {
      const src = readFileSync(tsFile, 'utf8');
      for (const pattern of SERVER_TOOL_PATTERNS) {
        for (const m of src.matchAll(new RegExp(pattern))) {
          for (let i = 1; i < m.length; i++) {
            if (m[i]) tools.add(m[i]);
          }
        }
      }
    }
    serverTools.set(serverKey, tools);
  }
  return serverTools;
}

describe('skill tool references → server tools', () => {
  const refs = extractSkillToolRefs();
  const serverTools = extractServerTools();

  it('found tool references in skills', () => {
    expect(refs.length).toBeGreaterThan(0);
  });

  const byServer = new Map<string, ToolRef[]>();
  for (const ref of refs) {
    const list = byServer.get(ref.server) ?? [];
    list.push(ref);
    byServer.set(ref.server, list);
  }

  for (const [server, serverRefs] of byServer) {
    describe(`flutter-ultra-${server}`, () => {
      const tools = serverTools.get(server);

      it('server package exists', () => {
        expect(tools, `No package found for flutter-ultra-${server}`).toBeDefined();
      });

      if (!tools) return;

      for (const toolName of [...new Set(serverRefs.map((r) => r.tool))]) {
        it(`tool "${toolName}" exists`, () => {
          expect(
            tools.has(toolName),
            `${toolName} referenced but not in flutter-ultra-${server}. At: ${serverRefs
              .filter((r) => r.tool === toolName)
              .map((r) => `${r.file}:${r.line}`)
              .join(', ')}`,
          ).toBe(true);
        });
      }
    });
  }
});
