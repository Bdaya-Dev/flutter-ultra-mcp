import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDevice } from './local.js';

const IS_WIN = process.platform === 'win32';

describe('LocalDevice', () => {
  it('runs a command and captures stdout/stderr', async () => {
    const device = new LocalDevice();
    const result = IS_WIN
      ? await device.exec('cmd', ['/c', 'echo hello-from-test'])
      : await device.exec('sh', ['-c', 'echo hello-from-test']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-from-test');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures a nonzero exit code', async () => {
    const device = new LocalDevice();
    const result = IS_WIN
      ? await device.exec('cmd', ['/c', 'exit 7'])
      : await device.exec('sh', ['-c', 'exit 7']);
    expect(result.exitCode).toBe(7);
  });

  it('reports fileExists correctly', async () => {
    const device = new LocalDevice();
    const dir = await mkdtemp(join(tmpdir(), 'ultra-localdev-'));
    const path = join(dir, 'present.txt');
    await writeFile(path, 'hello', 'utf8');
    expect(await device.fileExists(path)).toBe(true);
    expect(await device.fileExists(join(dir, 'absent.txt'))).toBe(false);
  });

  it('uploadFile copies and creates intermediate directories', async () => {
    const device = new LocalDevice();
    const dir = await mkdtemp(join(tmpdir(), 'ultra-localdev-'));
    const src = join(dir, 'src.txt');
    const dst = join(dir, 'nested', 'deeper', 'dst.txt');
    await writeFile(src, 'payload', 'utf8');
    const ret = await device.uploadFile(src, dst);
    expect(ret).toBe(dst);
    const contents = await readFile(dst, 'utf8');
    expect(contents).toBe('payload');
  });

  it('openRpcStream wires bidirectional stdio', async () => {
    // Use node itself as the helper — guaranteed present on every runner,
    // avoids shell-specific quoting differences between cmd.exe / sh / zsh.
    const device = new LocalDevice();
    const helper = [
      'process.stdin.setEncoding("utf8");',
      'let buf = "";',
      'process.stdin.on("data", (c) => { buf += c; });',
      'process.stdin.on("end", () => { process.stdout.write("got:" + buf.trim()); });',
    ].join(' ');
    const stream = await device.openRpcStream(process.execPath, ['-e', helper]);
    let stdout = '';
    stream.stdout.setEncoding('utf8');
    stream.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    stream.stdin.write('value\n');
    stream.stdin.end();
    const code = await stream.exit;
    expect(code).toBe(0);
    expect(stdout).toMatch(/got:value/);
    // Silence the unused-var warning on POSIX (IS_WIN is referenced for the
    // other tests' shell pick).
    void IS_WIN;
  });
});
