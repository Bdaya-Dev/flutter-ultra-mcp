// Flutter session discovery — 8-strategy ladder.
//
// Implements the discovery sequence from worker-P's empirical report
// (docs/discovery-empirics.md) and plan §7.1.
//
// Strategies (in order):
//   S1. Explicit URI passed by caller        (instant)
//   S2. Our own DTD instance                  (not impl v1 — opt-in)
//   S3. Spawner-written DTD info files        (not impl v1 — heuristic)
//   S4. VS Code LSP                           (not impl v1 — needs LSP client)
//   S5. Process scan + raw VM redirect trick  (PRIMARY — Windows-first)
//   S6. MCP-spawned `flutter run --machine`   (handled by launchApp.ts)
//   S7. Empty + user help                     (S6 fallback)
//
// On Windows we use WMI Win32_Process; on macOS/Linux we use `ps` + `lsof`.

import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from '@flutter-ultra/mcp-runtime';

const exec = promisify(execCb);

export interface DiscoveredSession {
  uri: string; // ws://… DDS-resolved
  rawVmUri?: string; // http://… raw VM (before DDS redirect)
  source: 'process-scan' | 'explicit' | 'machine-stdout' | 'dtd';
  pid?: number;
  device?: string;
  chromeCdpPort?: number;
  livenessChecked?: boolean;
  isolateCount?: number;
}

export interface DiscoveryOptions {
  logger: Logger;
  // Probe each candidate with HTTP GET to detect DDS redirect.
  probeTimeoutMs?: number;
}

interface ProcessInfo {
  pid: number;
  name: string;
  cmdline: string;
}

const HTTP_TIMEOUT_DEFAULT = 1_500;

export async function discover(options: DiscoveryOptions): Promise<DiscoveredSession[]> {
  const log = options.logger.child({ component: 'discovery' });
  const probeTimeout = options.probeTimeoutMs ?? HTTP_TIMEOUT_DEFAULT;

  const procs = await enumerateProcesses(log).catch((err) => {
    log.warn('process enumeration failed', { err: String(err) });
    return [] as ProcessInfo[];
  });

  const dartVmProcs = procs.filter((p) => {
    const cmd = p.cmdline.toLowerCase();
    return (
      cmd.includes('--enable-vm-service') ||
      cmd.includes('--observe') ||
      cmd.includes('vm-service-uri')
    );
  });

  log.debug('process scan complete', { totalProcs: procs.length, dartVmProcs: dartVmProcs.length });

  const seen = new Set<string>();
  const results: DiscoveredSession[] = [];

  for (const proc of dartVmProcs) {
    const candidates = extractVmCandidates(proc.cmdline);
    for (const cand of candidates) {
      try {
        const resolved = await resolveDdsUri(cand.url, probeTimeout);
        if (!resolved) continue;
        if (seen.has(resolved.wsUri)) continue;
        seen.add(resolved.wsUri);

        const liveness = await probeVmLiveness(resolved.wsUri, probeTimeout);
        if (!liveness.alive) {
          log.debug('candidate failed liveness probe', { url: resolved.wsUri });
          continue;
        }

        const session: DiscoveredSession = {
          uri: resolved.wsUri,
          source: 'process-scan',
          pid: proc.pid,
          livenessChecked: true,
          isolateCount: liveness.isolateCount,
          ...(cand.url !== resolved.wsUri ? { rawVmUri: cand.url } : {}),
        };
        const chromeCdp = findChromeCdpPort(procs);
        if (chromeCdp !== undefined) session.chromeCdpPort = chromeCdp;
        results.push(session);
      } catch (err) {
        log.debug('candidate probe failed', { url: cand.url, err: String(err) });
      }
    }
  }

  return results;
}

interface VmCandidate {
  url: string;
  port: number;
  token?: string;
}

function extractVmCandidates(cmdline: string): VmCandidate[] {
  const out: VmCandidate[] = [];
  // --enable-vm-service=<port>[/host]
  const enableMatch = cmdline.match(/--enable-vm-service=(\d+)(?:\/[^\s"]+)?/);
  if (enableMatch && enableMatch[1]) {
    const port = Number(enableMatch[1]);
    if (Number.isFinite(port)) out.push({ url: `http://127.0.0.1:${port}/`, port });
  }
  // --observe=<port>
  const observeMatch = cmdline.match(/--observe=(\d+)/);
  if (observeMatch && observeMatch[1]) {
    const port = Number(observeMatch[1]);
    if (Number.isFinite(port)) out.push({ url: `http://127.0.0.1:${port}/`, port });
  }
  // --vm-service-uri=http://127.0.0.1:<port>/<token>
  const vmUriMatch = cmdline.match(/--vm-service-uri=(https?:\/\/[^\s"]+)/);
  if (vmUriMatch && vmUriMatch[1]) {
    try {
      const u = new URL(vmUriMatch[1]);
      out.push({
        url: vmUriMatch[1],
        port: Number(u.port),
        token: u.pathname.replace(/^\/|\/$/g, ''),
      });
    } catch {
      /* ignore parse failure */
    }
  }
  return out;
}

interface ResolvedDds {
  wsUri: string;
  httpUri: string;
}

// Probe a raw VM URL. If DDS has taken over, the body redirects us to the
// real DDS URI. Worker-P's report confirmed this works on Windows.
async function resolveDdsUri(url: string, timeoutMs: number): Promise<ResolvedDds | null> {
  const httpUri = await tryDdsRedirect(url, timeoutMs);
  if (httpUri) {
    const wsUri = httpToWs(httpUri);
    return { wsUri, httpUri };
  }
  // Maybe the URL itself is already the DDS URI. Convert + return.
  if (/^https?:\/\//i.test(url)) {
    return { wsUri: httpToWs(url), httpUri: url };
  }
  return null;
}

async function tryDdsRedirect(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const text = await resp.text();
    const match = text.match(/(https?:\/\/[^\s"<>]+\/[A-Za-z0-9_=-]+=?\/?)/);
    if (match && match[1] && match[1] !== url) {
      return match[1];
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface LivenessResult {
  alive: boolean;
  isolateCount: number;
}

async function probeVmLiveness(wsUri: string, timeoutMs: number): Promise<LivenessResult> {
  const { WebSocket } = await import('ws');
  return new Promise<LivenessResult>((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve({ alive: false, isolateCount: 0 });
    }, timeoutMs);

    const ws = new WebSocket(wsUri);

    ws.on('error', () => {
      clearTimeout(timer);
      ws.close();
      resolve({ alive: false, isolateCount: 0 });
    });

    ws.on('open', () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVM', params: {} }));
    });

    ws.on('message', (data: Buffer | string) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(data.toString()) as {
          result?: { isolates?: Array<{ id: string }> };
        };
        const isolates = msg.result?.isolates ?? [];
        ws.close();
        resolve({ alive: isolates.length > 0, isolateCount: isolates.length });
      } catch {
        ws.close();
        resolve({ alive: false, isolateCount: 0 });
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
    });
  });
}

export function httpToWs(httpUri: string): string {
  let s = httpUri.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
  // DDS WS endpoint is the http path + /ws
  if (!s.endsWith('/ws')) {
    s = s.replace(/\/$/, '') + '/ws';
  }
  return s;
}

function findChromeCdpPort(procs: ProcessInfo[]): number | undefined {
  for (const p of procs) {
    if (!/chrome(\.exe)?$/i.test(p.name)) continue;
    if (!/flutter_tools_chrome_device/.test(p.cmdline)) continue;
    const m = p.cmdline.match(/--remote-debugging-port=(\d+)/);
    if (m && m[1]) {
      const port = Number(m[1]);
      if (Number.isFinite(port)) return port;
    }
  }
  return undefined;
}

async function enumerateProcesses(log: Logger): Promise<ProcessInfo[]> {
  if (process.platform === 'win32') {
    return enumerateWindows(log);
  }
  return enumerateUnix(log);
}

// Windows: WMIC is deprecated, use PowerShell CIM with stable schema.
async function enumerateWindows(log: Logger): Promise<ProcessInfo[]> {
  // Use the | character as a delimiter; CommandLine can contain just about anything else.
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'dart|flutter|chrome|node' } | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.Name + '|' + ($_.CommandLine -replace '\\r?\\n', ' ') }";
  const { stdout } = await exec(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const lines = stdout.split(/\r?\n/);
  const out: ProcessInfo[] = [];
  for (const line of lines) {
    if (!line) continue;
    const idx1 = line.indexOf('|');
    const idx2 = line.indexOf('|', idx1 + 1);
    if (idx1 < 0 || idx2 < 0) continue;
    const pid = Number(line.slice(0, idx1));
    const name = line.slice(idx1 + 1, idx2);
    const cmdline = line.slice(idx2 + 1);
    if (Number.isFinite(pid)) out.push({ pid, name, cmdline });
  }
  log.debug('enumerateWindows', { count: out.length });
  return out;
}

async function enumerateUnix(log: Logger): Promise<ProcessInfo[]> {
  const { stdout } = await exec('ps -eo pid=,comm=,args=', { maxBuffer: 64 * 1024 * 1024 });
  const lines = stdout.split('\n');
  const out: ProcessInfo[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    const firstSpace = trimmed.indexOf(' ');
    if (firstSpace < 0) continue;
    const pid = Number(trimmed.slice(0, firstSpace));
    const rest = trimmed.slice(firstSpace + 1);
    const secondSpace = rest.indexOf(' ');
    if (secondSpace < 0) continue;
    const name = rest.slice(0, secondSpace);
    const cmdline = rest.slice(secondSpace + 1);
    if (!/dart|flutter|chrome|node/i.test(name) && !/dart|flutter/i.test(cmdline)) continue;
    if (Number.isFinite(pid)) out.push({ pid, name, cmdline });
  }
  log.debug('enumerateUnix', { count: out.length });
  return out;
}
