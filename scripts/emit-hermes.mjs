#!/usr/bin/env node
// emit-hermes.mjs — Generate a Hermes native plugin from the flutter-ultra MCP servers.
//
// Design: BUILD ARTIFACT, not second runtime entrypoint.
// - One source of truth: the MCP server definitions (packages/*/src/tools/).
// - This script probes each package's bin.js via MCP stdio JSON-RPC (tools/list)
//   to extract name, description, and JSON Schema for every tool.
// - It emits a Python package (dist/hermes-flutter-ultra/) that Hermes loads as a
//   native plugin. The Python handlers spawn the pre-built MCP server subprocesses
//   and forward tool calls via stdio JSON-RPC.
//
// The .claude-plugin/ manifest (Claude Code) is untouched — this is additive.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const packages = [
  'flutter-ultra-gesture',
  'flutter-ultra-browser',
  'flutter-ultra-build',
  'flutter-ultra-devtools',
  'flutter-ultra-native-desktop',
  'flutter-ultra-native-mobile',
  'flutter-ultra-patrol',
  'flutter-ultra-runtime',
];

// Friendly toolset names (strip package prefix).
function toolsetFor(pkg) {
  return pkg.replace('flutter-ultra-', '').replace(/-/g, '_');
}

async function probe(binPath) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [binPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let stdout = '';
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch { /* ignore */ }
        res(v);
      }
    };
    const fail = (e) => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch { /* ignore */ }
        rej(e);
      }
    };

    child.stderr.on('data', () => { /* discard server logs */ });

    const pending = new Map();
    let nextId = 1;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split('\n');
      stdout = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
        } catch { /* ignore */ }
      }
    });

    const send = (method, params) => {
      const id = nextId++;
      const msg = { jsonrpc: '2.0', id, method, params: params ?? {} };
      child.stdin.write(JSON.stringify(msg) + '\n');
      return new Promise((r) => pending.set(id, r));
    };

    const timer = setTimeout(() => fail(new Error('timeout')), 20000);

    (async () => {
      try {
        await send('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'hermes-emit', version: '0.0.1' },
        });
        child.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
        );
        const toolsResp = await send('tools/list', {});
        clearTimeout(timer);
        done(toolsResp?.result?.tools ?? []);
      } catch (e) {
        clearTimeout(timer);
        fail(e);
      }
    })();
  });
}

async function main() {
  const outDir = resolve(root, 'dist', 'hermes-flutter-ultra');
  mkdirSync(outDir, { recursive: true });

  // 1. Probe every package.
  const manifest = { packages: {} };
  let total = 0;
  for (const pkg of packages) {
    const bin = resolve(root, 'packages', pkg, 'dist', 'bin.js');
    if (!existsSync(bin)) {
      console.error(`WARN: ${pkg} bin not found at ${bin} — run 'npm run build' first`);
      continue;
    }
    try {
      const tools = await probe(bin);
      manifest.packages[pkg] = {
        toolset: toolsetFor(pkg),
        bin: `packages/${pkg}/dist/bin.js`,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
        })),
      };
      total += tools.length;
      console.log(`${pkg}: ${tools.length} tools`);
    } catch (e) {
      console.error(`${pkg}: ERR ${e.message}`);
    }
  }
  console.log(`\nTotal: ${total} tools across ${Object.keys(manifest.packages).length} packages`);

  // 2. Write the tool manifest (consumed by the Python plugin at import time).
  writeFileSync(resolve(outDir, 'tools.json'), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${outDir}/tools.json`);

  // 3. Generate plugin.yaml from the probed tool list (Hermes requires every
  //    tool name listed under provides_tools).
  const allToolNames = [];
  for (const info of Object.values(manifest.packages)) {
    for (const t of info.tools) allToolNames.push(t.name);
  }
  const pluginYaml = [
    'name: hermes-flutter-ultra',
    'version: 0.1.0',
    'description: >',
    '  Flutter automation estate (286 tools across 8 MCP servers: gesture,',
    '  browser, build, devtools, native-desktop, native-mobile, patrol, runtime)',
    '  exposed to Hermes as a native plugin. Handlers forward to the pre-built',
    '  MCP server subprocesses via stdio JSON-RPC. Generated at build time by',
    '  scripts/emit-hermes.mjs — do not edit the generated files directly.',
    'author: "Bdaya-Dev <https://github.com/Bdaya-Dev>"',
    'homepage: https://github.com/Bdaya-Dev/flutter-ultra-mcp',
    `provides_tools:`,
    // Quote tool names: a name containing a YAML indicator (`:` `#` `@` etc.)
    // would otherwise silently corrupt the document rather than fail loudly.
    ...allToolNames.map((n) => `  - ${JSON.stringify(n)}`),
    'pip_dependencies: []',
    '',
  ].join('\n');
  writeFileSync(resolve(outDir, 'plugin.yaml'), pluginYaml);
  console.log(`Wrote ${outDir}/plugin.yaml (${allToolNames.length} tools)`);

  // 4. Copy the static Python plugin files from hermes-plugin-src/.
  const srcDir = resolve(root, 'hermes-plugin-src');
  if (!existsSync(srcDir)) {
    console.error(`FATAL: ${srcDir} missing — cannot emit plugin`);
    process.exit(1);
  }
  for (const entry of ['__init__.py', 'bridge.py']) {
    const src = resolve(srcDir, entry);
    if (!existsSync(src)) {
      console.error(`FATAL: ${src} missing`);
      process.exit(1);
    }
    cpSync(src, resolve(outDir, entry));
  }
  console.log(`Wrote ${outDir}/__init__.py, bridge.py`);

  // 5. Write a README for the emitted artifact.
  writeFileSync(
    resolve(outDir, 'README.md'),
    `# hermes-flutter-ultra (generated)

Hermes native plugin that exposes all flutter-ultra MCP tools to Hermes agents.

**This directory is a BUILD ARTIFACT.** Do not edit files here — edit
\`hermes-plugin-src/\` (static Python) or \`scripts/emit-hermes.mjs\` (emitter)
and re-run \`npm run emit:hermes\`.

## Install

\`\`\`bash
hermes plugins install --from-dir dist/hermes-flutter-ultra
# or: copy dist/hermes-flutter-ultra/ to $HERMES_HOME/plugins/hermes-flutter-ultra/
\`\`\`

## How it works

- \`tools.json\` (generated) — every tool's name, description, and JSON Schema,
  probed from each package's MCP server via stdio JSON-RPC \`tools/list\`.
- \`__init__.py\` — reads \`tools.json\` at \`register(ctx)\` time, calls
  \`ctx.register_tool(...)\` for every tool across all 8 packages.
- \`bridge.py\` — per-package MCP server subprocess pool. Each tool handler
  spawns (or reuses) the corresponding \`packages/*/dist/bin.js\` stdio process,
  sends \`initialize\` + \`tools/call\`, and returns the result.

## Tool count

${Object.entries(manifest.packages)
  .map(([pkg, info]) => `- \`${pkg}\`: ${info.tools.length} tools (toolset \`${info.toolset}\`)`)
  .join('\n')}

Total: ${total} tools.
`,
  );
  console.log(`Wrote ${outDir}/README.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
