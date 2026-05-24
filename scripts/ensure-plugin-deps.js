#!/usr/bin/env node
// Ensures production dependencies (playwright-core) are installed in
// CLAUDE_PLUGIN_DATA. Strips workspaces/devDependencies from the copied
// package.json so npm install works in a flat directory.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const pluginData = process.env.CLAUDE_PLUGIN_DATA;
if (!pluginRoot || !pluginData) {
  process.exit(0);
}

const srcPkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
const cleaned = {
  name: srcPkg.name,
  version: srcPkg.version,
  dependencies: srcPkg.dependencies || {},
};
const cleanedStr = JSON.stringify(cleaned, null, 2) + '\n';

const dstPath = path.join(pluginData, 'package.json');
try {
  if (fs.readFileSync(dstPath, 'utf8') === cleanedStr) {
    const nmExists = fs.existsSync(path.join(pluginData, 'node_modules', 'playwright-core'));
    if (nmExists) process.exit(0);
  }
} catch {}

fs.writeFileSync(dstPath, cleanedStr);
try {
  execSync('npm install --production --no-audit --no-fund', {
    cwd: pluginData,
    stdio: 'inherit',
    timeout: 90_000,
  });
} catch {
  fs.unlinkSync(dstPath);
  process.exit(1);
}
