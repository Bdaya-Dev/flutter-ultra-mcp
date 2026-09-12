// Hermes plugin emit pipeline — structural validation.
//
// Verifies the build-time emitter exists and the static Python plugin source
// has the required shape. Does NOT run the emitter (that spawns 8 MCP server
// subprocesses); the integration test is scripts/test-hermes-register.py.
//
// Run: npx vitest run tests/hermes-emit.test.ts

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

describe('hermes-plugin-src (static Python plugin template)', () => {
  const srcDir = join(ROOT, 'hermes-plugin-src');

  it('hermes-plugin-src/ exists', () => {
    expect(existsSync(srcDir)).toBe(true);
  });

  it('__init__.py exists and has a register() function', () => {
    const init = readFileSync(join(srcDir, '__init__.py'), 'utf8');
    expect(init).toContain('def register(');
    expect(init).toContain('ctx.register_tool(');
  });

  it('bridge.py exists and has a SubprocessPool class', () => {
    const bridge = readFileSync(join(srcDir, 'bridge.py'), 'utf8');
    expect(bridge).toContain('class SubprocessPool');
    expect(bridge).toContain('class McpSubprocess');
    expect(bridge).toContain('def call(');
  });
});

describe('scripts/emit-hermes.mjs (build-time emitter)', () => {
  it('emitter script exists', () => {
    expect(existsSync(join(ROOT, 'scripts', 'emit-hermes.mjs'))).toBe(true);
  });

  it('emitter references all 8 packages', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'emit-hermes.mjs'), 'utf8');
    for (const pkg of [
      'flutter-ultra-gesture',
      'flutter-ultra-browser',
      'flutter-ultra-build',
      'flutter-ultra-devtools',
      'flutter-ultra-native-desktop',
      'flutter-ultra-native-mobile',
      'flutter-ultra-patrol',
      'flutter-ultra-runtime',
    ]) {
      expect(script).toContain(pkg);
    }
  });

  it('emitter uses MCP stdio JSON-RPC tools/list (not hardcoded)', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'emit-hermes.mjs'), 'utf8');
    expect(script).toContain('tools/list');
    expect(script).toContain('initialize');
  });
});

describe('npm scripts', () => {
  it('package.json has emit:hermes script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['emit:hermes']).toBe('node scripts/emit-hermes.mjs');
  });
});

describe('.claude-plugin/ (Claude Code plugin, must not be broken)', () => {
  it('plugin.json still exists', () => {
    expect(existsSync(join(ROOT, '.claude-plugin', 'plugin.json'))).toBe(true);
  });

  it('marketplace.json still exists', () => {
    expect(existsSync(join(ROOT, '.claude-plugin', 'marketplace.json'))).toBe(true);
  });
});
