#!/usr/bin/env node
// Ensures playwright-core is installed. Called by the SessionStart hook.
// Usage: node ensure-playwright.js <install-dir>
//
// Checks if playwright-core is resolvable from <install-dir>/node_modules.
// If not, runs npm install there. If <install-dir> is not provided,
// falls back to the script's own directory (plugin root).

const { existsSync, mkdirSync } = require('fs');
const { execSync } = require('child_process');
const { resolve, join } = require('path');

const installDir = process.argv[2] || __dirname;
const nmDir = join(installDir, 'node_modules');

try {
  require.resolve('playwright-core', { paths: [nmDir] });
  // Already installed — nothing to do.
} catch {
  if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true });
  try {
    execSync('npm install --no-save --ignore-scripts playwright-core', {
      cwd: installDir,
      stdio: 'inherit',
    });
  } catch (err) {
    process.stderr.write(`[flutter-ultra] Failed to install playwright-core: ${err.message}\n`);
    // Non-fatal — the browser server will show a clear error when used.
  }
}
