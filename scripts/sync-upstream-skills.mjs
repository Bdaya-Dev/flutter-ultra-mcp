#!/usr/bin/env node
/**
 * Syncs SKILL.md files from upstream flutter/skills and dart-lang/skills repos
 * into the flutter-ultra plugin's skills/ directory.
 *
 * Usage:
 *   node scripts/sync-upstream-skills.mjs [--dry-run]
 *
 * Upstream skills are BSD-3-Clause licensed. This script preserves their
 * content and appends a "Flutter Ultra Integration" footer with relevant
 * MCP tool references. The footer is regenerated on each sync; manual edits
 * to vendored files will be overwritten.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', 'skills');
const ENHANCEMENTS_PATH = join(__dirname, 'upstream-skill-enhancements.json');

const UPSTREAM_REPOS = [
  {
    owner: 'flutter',
    repo: 'skills',
    prefix: 'flutter-',
    branch: 'main',
  },
  {
    owner: 'dart-lang',
    repo: 'skills',
    prefix: 'dart-',
    branch: 'main',
  },
];

const ATTRIBUTION_FOOTER = `

---

> **Attribution:** This skill is vendored from [{{owner}}/{{repo}}](https://github.com/{{owner}}/{{repo}}) (BSD-3-Clause).
> Synced by \`scripts/sync-upstream-skills.mjs\`. Do not edit manually — changes will be overwritten on next sync.
`;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.text();
}

function stripPrefix(name, prefix) {
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function transformFrontmatter(content, newName, owner, repo) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return content;

  let frontmatter = fmMatch[1];

  // Replace name field — strip the flutter-/dart- prefix since the plugin
  // already namespaces skills under `flutter:`
  frontmatter = frontmatter.replace(/^name:\s*.+$/m, `name: ${newName}`);

  // Remove metadata.model (Gemini reference not relevant to our plugin)
  frontmatter = frontmatter.replace(/\nmetadata:\n(?:\s+\w+:.*\n)*/g, '\n');

  // Clean trailing whitespace
  frontmatter = frontmatter.trimEnd();

  const body = content.slice(fmMatch[0].length);
  return `---\n${frontmatter}\n---\n${body}`;
}

function buildAttribution(owner, repo) {
  return ATTRIBUTION_FOOTER.replace(/\{\{owner\}\}/g, owner).replace(/\{\{repo\}\}/g, repo);
}

function loadEnhancements() {
  if (!existsSync(ENHANCEMENTS_PATH)) return {};
  return JSON.parse(readFileSync(ENHANCEMENTS_PATH, 'utf-8'));
}

function buildEnhancementSection(skillName, enhancements) {
  const entry = enhancements[skillName];
  if (!entry || !entry.tools || entry.tools.length === 0) return '';

  let section = '\n## Flutter Ultra Integration\n\n';
  if (entry.description) {
    section += `${entry.description}\n\n`;
  }
  for (const tool of entry.tools) {
    section += `- \`${tool.name}\` — ${tool.description}\n`;
  }
  return section;
}

async function syncRepo({ owner, repo, prefix, branch }) {
  console.log(`\nSyncing ${owner}/${repo}...`);

  const dirs = await fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/contents/skills?ref=${branch}`,
  );

  const skillDirs = dirs.filter((d) => d.type === 'dir');
  console.log(`  Found ${skillDirs.length} skills`);

  const enhancements = loadEnhancements();
  const results = [];

  for (const dir of skillDirs) {
    const originalName = dir.name;
    const newName = stripPrefix(originalName, prefix);
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/skills/${originalName}/SKILL.md`;

    try {
      let content = await fetchText(url);
      content = transformFrontmatter(content, newName, owner, repo);

      // Append enhancement section if available
      const enhancement = buildEnhancementSection(newName, enhancements);
      if (enhancement) {
        content = content.trimEnd() + '\n' + enhancement;
      }

      // Append attribution
      content = content.trimEnd() + buildAttribution(owner, repo) + '\n';

      const outDir = join(SKILLS_DIR, newName);
      const outPath = join(outDir, 'SKILL.md');

      if (!process.argv.includes('--dry-run')) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(outPath, content, 'utf-8');
      }

      console.log(`  ✓ ${originalName} → skills/${newName}/SKILL.md`);
      results.push({ originalName, newName, status: 'ok' });
    } catch (err) {
      console.error(`  ✗ ${originalName}: ${err.message}`);
      results.push({ originalName, newName, status: 'error', error: err.message });
    }
  }

  return results;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('DRY RUN — no files will be written\n');

  console.log('Upstream skill sync for flutter-ultra-mcp');
  console.log('==========================================');

  const allResults = [];
  for (const repo of UPSTREAM_REPOS) {
    const results = await syncRepo(repo);
    allResults.push(...results);
  }

  const ok = allResults.filter((r) => r.status === 'ok').length;
  const err = allResults.filter((r) => r.status === 'error').length;
  console.log(`\nDone: ${ok} synced, ${err} errors`);

  if (err > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
