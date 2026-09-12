// Probe all 8 packages for tool definitions by spawning each bin as a
// subprocess and exchanging MCP stdio JSON-RPC (initialize → tools/list).
//
// Used by the Hermes plugin emitter (scripts/emit-hermes.mjs).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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

async function probe(binPath) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [binPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; child.kill(); res(v); } };
    const fail = (e) => { if (!settled) { settled = true; child.kill(); rej(e); } };

    child.stderr.on('data', (c) => { stderr += c.toString(); });

    const pending = new Map();
    let nextId = 1;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      // MCP stdio: newline-delimited JSON-RPC
      const lines = stdout.split('\n');
      stdout = lines.pop(); // keep partial
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
      return new Promise((resolve) => pending.set(id, resolve));
    };

    const timer = setTimeout(() => fail(new Error('timeout')), 15000);

    (async () => {
      try {
        // MCP handshake: initialize → initialized notification → tools/list
        const initResp = await send('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'probe', version: '0.0.1' },
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        const toolsResp = await send('tools/list', {});
        clearTimeout(timer);
        done({ init: initResp, tools: toolsResp?.result?.tools ?? [], stderr });
      } catch (e) {
        clearTimeout(timer);
        fail(e);
      }
    })();
  });
}

const all = {};
for (const pkg of packages) {
  const bin = resolve(root, 'packages', pkg, 'dist', 'bin.js');
  try {
    const result = await probe(bin);
    all[pkg] = result.tools;
    console.log(`${pkg}: ${result.tools.length} tools`);
  } catch (e) {
    console.log(`${pkg}: ERR ${e.message}`);
    all[pkg] = [];
  }
}

writeFileSync(resolve(root, 'scripts', 'probe-tools-output.json'), JSON.stringify(all, null, 2));
const total = Object.values(all).reduce((s, t) => s + t.length, 0);
console.log(`\nTotal: ${total} tools. Wrote scripts/probe-tools-output.json`);
