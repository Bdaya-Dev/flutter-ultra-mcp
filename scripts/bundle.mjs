#!/usr/bin/env node
/**
 * Bundle each MCP server into a single self-contained .cjs file.
 *
 * Usage:  node scripts/bundle.mjs
 *
 * Output: packages/<server>/dist/bin.cjs
 *
 * Most dependencies are inlined. Exceptions:
 *   - playwright-core: too large / has dynamic requires of chromium-bidi.
 *     Servers that use it (browser, native-mobile) need `npm install playwright-core`
 *     at runtime OR the monorepo node_modules present.
 */

import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/**
 * Packages that cannot be inlined because they have complex internal
 * dynamic requires or native bindings.
 */
const ALWAYS_EXTERNAL = [
  'playwright-core',
  'playwright-core/*',
  'ssh2',
  'ssh2/*',
  'cpu-features',
];

/** Shim file that provides __importMetaUrl for CJS output. */
const importMetaShim = resolve(__dirname, 'import-meta-shim.js');

/** @type {Array<{ pkg: string; entry: string; out: string }>} */
const servers = [
  { pkg: 'flutter-ultra-build',          entry: 'src/index.ts', out: 'dist/bin.cjs' },
  { pkg: 'flutter-ultra-runtime',        entry: 'src/bin.ts',   out: 'dist/bin.cjs' },
  { pkg: 'flutter-ultra-gesture',        entry: 'src/bin.ts',   out: 'dist/bin.cjs' },
  { pkg: 'flutter-ultra-browser',        entry: 'src/bin.ts',   out: 'dist/bin.cjs' },
  { pkg: 'flutter-ultra-native-mobile',  entry: 'src/bin.ts',   out: 'dist/bin.cjs' },
  { pkg: 'flutter-ultra-native-desktop', entry: 'src/bin.ts',   out: 'dist/bin.cjs' },
  { pkg: 'flutter-ultra-devtools',       entry: 'src/index.ts', out: 'dist/bin.cjs' },
  { pkg: 'flutter-ultra-patrol',         entry: 'src/bin.ts',   out: 'dist/bin.cjs' },
];

const errors = [];

for (const { pkg, entry, out } of servers) {
  const pkgDir = resolve(root, 'packages', pkg);
  const entryPoint = resolve(pkgDir, entry);
  const outfile = resolve(pkgDir, out);

  console.log(`\n--- Bundling ${pkg} ---`);
  console.log(`  entry: ${entryPoint}`);
  console.log(`  out:   ${outfile}`);

  try {
    const result = await build({
      entryPoints: [entryPoint],
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      sourcemap: false,
      external: ALWAYS_EXTERNAL,
      // esbuild auto-preserves shebangs from source entry points,
      // so we do NOT add one via banner (that would duplicate it).
      //
      // Replace import.meta.url with the injected __importMetaUrl binding.
      define: {
        'import.meta.url': '__importMetaUrl',
      },
      inject: [importMetaShim],
      logLevel: 'warning',
      minifyWhitespace: true,
      minifyIdentifiers: false,
      minifySyntax: true,
    });

    if (result.warnings.length > 0) {
      console.log(`  warnings: ${result.warnings.length}`);
    }
    console.log(`  OK`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    errors.push(pkg);
  }
}

if (errors.length > 0) {
  console.error(`\nFailed to bundle: ${errors.join(', ')}`);
  process.exit(1);
}

console.log('\nAll 8 servers bundled successfully.');
