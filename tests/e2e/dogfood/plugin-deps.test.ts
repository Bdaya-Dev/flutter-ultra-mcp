// E2E: bundled MCP servers that mark ssh2/playwright-core as esbuild externals
// must start in plugin-isolated layout (bin.cjs + CLAUDE_PLUGIN_DATA node_modules).
//
// Reproduces the Claude plugin cache layout where only dist/bin.cjs ships and
// ensure-plugin-deps.js installs native deps into CLAUDE_PLUGIN_DATA.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn, type ChildProcess, execSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '../../..');

const SERVERS = [
  {
    name: 'flutter-ultra-native-desktop',
    bin: resolve(ROOT, 'packages/flutter-ultra-native-desktop/dist/bin.cjs'),
    serverInfoName: 'flutter-ultra-native-desktop',
  },
  {
    name: 'flutter-ultra-native-mobile',
    bin: resolve(ROOT, 'packages/flutter-ultra-native-mobile/dist/bin.cjs'),
    serverInfoName: 'flutter-ultra-native-mobile',
  },
] as const;

const REQUIRED_DEPS = ['playwright-core', 'ssh2'] as const;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function collectResponses(
  proc: ChildProcess,
  count: number,
  timeoutMs: number,
): Promise<JsonRpcResponse[]> {
  return new Promise((resolvePromise, reject) => {
    const results: JsonRpcResponse[] = [];
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${count} responses`)),
      timeoutMs,
    );

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse;
          if (parsed.id !== undefined) {
            results.push(parsed);
            if (results.length >= count) {
              clearTimeout(timer);
              resolvePromise(results);
            }
          }
        } catch {
          // non-JSON — skip
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function spawnMcpServer(bin: string, nodePath: string): ChildProcess {
  return spawn('node', [bin], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FLUTTER_ULTRA_STATE_DIR: '',
      NODE_PATH: nodePath,
    },
  });
}

describe('plugin external deps (ssh2, playwright-core)', () => {
  for (const dep of REQUIRED_DEPS) {
    it(`${dep} exists in root node_modules after npm ci`, () => {
      expect(existsSync(join(ROOT, 'node_modules', dep))).toBe(true);
    });
  }

  describe('isolated plugin-data install via ensure-plugin-deps.js', () => {
    let pluginRoot: string;
    let pluginData: string;

    beforeAll(async () => {
      pluginRoot = join(tmpdir(), `flutter-ultra-plugin-root-${process.pid}`);
      pluginData = join(tmpdir(), `flutter-ultra-plugin-data-${process.pid}`);
      rmSync(pluginRoot, { recursive: true, force: true });
      rmSync(pluginData, { recursive: true, force: true });
      mkdirSync(pluginRoot, { recursive: true });
      mkdirSync(pluginData, { recursive: true });

      for (const server of SERVERS) {
        const distDir = join(pluginRoot, 'packages', server.name, 'dist');
        mkdirSync(distDir, { recursive: true });
        cpSync(server.bin, join(distDir, 'bin.cjs'));
      }
      cpSync(join(ROOT, 'package.json'), join(pluginRoot, 'package.json'));
      cpSync(
        join(ROOT, 'scripts/ensure-plugin-deps.js'),
        join(pluginRoot, 'ensure-plugin-deps.js'),
      );

      execSync('node ensure-plugin-deps.js', {
        cwd: pluginRoot,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: pluginRoot,
          CLAUDE_PLUGIN_DATA: pluginData,
        },
        stdio: 'pipe',
        timeout: 120_000,
      });

      for (const dep of REQUIRED_DEPS) {
        expect(existsSync(join(pluginData, 'node_modules', dep))).toBe(true);
      }
    }, 120_000);

    for (const server of SERVERS) {
      describe(`${server.name} bin.cjs`, () => {
        let proc: ChildProcess | undefined;

        afterEach(() => {
          proc?.stdin?.end();
          proc?.kill('SIGTERM');
          proc = undefined;
        });

        it('starts and responds to MCP initialize without MODULE_NOT_FOUND', async () => {
          const isolatedBin = join(pluginRoot, 'packages', server.name, 'dist', 'bin.cjs');
          proc = spawnMcpServer(isolatedBin, join(pluginData, 'node_modules'));

          const stderrLines: string[] = [];
          proc.stderr?.on('data', (c: Buffer) => stderrLines.push(c.toString()));

          await new Promise<void>((resolveWait, reject) => {
            const timer = setTimeout(resolveWait, 1500);
            proc!.once('exit', (code) => {
              clearTimeout(timer);
              if (code !== 0 && code !== null) {
                reject(
                  new Error(`Server exited with code ${code}. stderr: ${stderrLines.join('')}`),
                );
              } else {
                resolveWait();
              }
            });
          });

          expect(stderrLines.join('')).not.toMatch(/Cannot find module 'ssh2'/);
          expect(proc.exitCode).toBeNull();

          proc.stdin!.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'plugin-deps-test', version: '0.0.0' },
              },
            }) + '\n',
          );

          const [initResp] = await collectResponses(proc, 1, 15_000);
          expect(initResp!.error).toBeUndefined();
          const result = initResp!.result as { serverInfo?: { name?: string } };
          expect(result.serverInfo?.name).toBe(server.serverInfoName);
        }, 30_000);
      });
    }
  });

  describe('monorepo bundled bins (post-build)', () => {
    let proc: ChildProcess | undefined;

    afterEach(() => {
      proc?.stdin?.end();
      proc?.kill('SIGTERM');
      proc = undefined;
    });

    it('native-desktop bin.cjs starts using hoisted root node_modules', async () => {
      const bin = SERVERS[0]!.bin;
      expect(existsSync(bin)).toBe(true);

      proc = spawn('node', [bin], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FLUTTER_ULTRA_STATE_DIR: '' },
      });

      const stderrLines: string[] = [];
      proc.stderr?.on('data', (c: Buffer) => stderrLines.push(c.toString()));

      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 1500));
      expect(stderrLines.join('')).not.toMatch(/Cannot find module 'ssh2'/);
      expect(proc.exitCode).toBeNull();

      proc.stdin!.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'monorepo-test', version: '0.0.0' },
          },
        }) + '\n',
      );

      const [initResp] = await collectResponses(proc, 1, 15_000);
      expect(initResp!.error).toBeUndefined();
    }, 30_000);
  });
});
