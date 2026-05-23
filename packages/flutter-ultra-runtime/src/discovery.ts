// Flutter session discovery — 8-strategy ladder.
//
// Implements the discovery sequence from worker-P's empirical report
// (docs/discovery-empirics.md) and plan §7.1.
//
// Strategies (in order):
//   S1. Explicit URI passed by caller        (instant)
//   S2. Dart Tooling Daemon (DTD)              (`dart tooling-daemon --list`)
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

  // S2: DTD discovery — find apps launched by IDEs (VS Code, IntelliJ)
  const dtdSessions = await discoverViaDtd(log, probeTimeout).catch((err) => {
    log.debug('DTD discovery skipped', { err: String(err) });
    return [] as DiscoveredSession[];
  });

  // S5: Process scan — find apps launched via `flutter run`
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

  // Add DTD-discovered sessions first (higher quality — IDE-launched apps)
  for (const dtdSession of dtdSessions) {
    if (!seen.has(dtdSession.uri)) {
      seen.add(dtdSession.uri);
      results.push(dtdSession);
    }
  }

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

export function findChromeCdpPort(procs: ProcessInfo[]): number | undefined {
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

// -- DTD discovery (Strategy S2) -----------------------------------------------
//
// Runs `dart tooling-daemon --list` to find DTD instances, then queries each
// for connected apps. This discovers apps launched by IDEs (VS Code, IntelliJ)
// that process scanning cannot find.

async function findDartSdkPath(): Promise<string | null> {
  // Check DART_ROOT env var first (new in Dart 3.12)
  if (process.env.DART_ROOT) {
    return `${process.env.DART_ROOT}/bin/dart`;
  }
  // Try to resolve from PATH
  try {
    const cmd = process.platform === 'win32' ? 'where dart' : 'which dart';
    const { stdout } = await exec(cmd, { timeout: 5_000 });
    const path = stdout.trim().split(/\r?\n/)[0];
    return path || null;
  } catch {
    return null;
  }
}

interface DtdInstance {
  uri: string;
  workingDir?: string;
}

function parseDtdList(stdout: string): DtdInstance[] {
  const instances: DtdInstance[] = [];
  // Output format: one DTD per line with URI and optional working directory
  // Lines look like: ws://127.0.0.1:PORT/TOKEN= (workingDir: /path/to/project)
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const wsMatch = trimmed.match(/(wss?:\/\/[^\s()]+)/);
    if (wsMatch?.[1]) {
      const dirMatch = trimmed.match(/workingDir:\s*([^\s()]+)/i);
      instances.push({
        uri: wsMatch[1],
        ...(dirMatch?.[1] ? { workingDir: dirMatch[1] } : {}),
      });
    }
  }
  return instances;
}

async function queryDtdForApps(dtdUri: string, timeoutMs: number): Promise<DiscoveredSession[]> {
  const { WebSocket } = await import('ws');
  return new Promise<DiscoveredSession[]>((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve([]);
    }, timeoutMs);

    const ws = new WebSocket(dtdUri);

    ws.on('error', () => {
      clearTimeout(timer);
      ws.close();
      resolve([]);
    });

    ws.on('open', () => {
      // Query for connected VM services via DTD's getVmServices RPC
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getVmServices',
          params: {},
        }),
      );
    });

    ws.on('message', (data: Buffer | string) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(data.toString()) as {
          result?: {
            vmServicesInfos?: Array<{ uri: string; name?: string }>;
          };
          error?: { message: string };
        };

        if (msg.error || !msg.result?.vmServicesInfos) {
          ws.close();
          resolve([]);
          return;
        }

        const sessions: DiscoveredSession[] = msg.result.vmServicesInfos.map((info) => ({
          uri: info.uri.endsWith('/ws') ? info.uri : info.uri.replace(/\/?$/, '/ws'),
          source: 'dtd' as const,
          ...(info.name !== undefined ? { device: info.name } : {}),
        }));

        ws.close();
        resolve(sessions);
      } catch {
        ws.close();
        resolve([]);
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
    });
  });
}

async function discoverViaDtd(log: Logger, probeTimeout: number): Promise<DiscoveredSession[]> {
  const dartPath = await findDartSdkPath();
  if (!dartPath) {
    log.debug('DTD discovery: dart SDK not found in PATH');
    return [];
  }

  let stdout: string;
  try {
    const result = await exec(`"${dartPath}" tooling-daemon --list`, {
      timeout: 10_000,
    });
    stdout = result.stdout;
  } catch (err) {
    log.debug('DTD discovery: dart tooling-daemon --list failed', {
      err: String(err),
    });
    return [];
  }

  const dtdInstances = parseDtdList(stdout);
  if (dtdInstances.length === 0) {
    log.debug('DTD discovery: no DTD instances found');
    return [];
  }

  log.debug('DTD discovery: found instances', { count: dtdInstances.length });

  const allSessions: DiscoveredSession[] = [];
  for (const dtd of dtdInstances) {
    const sessions = await queryDtdForApps(dtd.uri, probeTimeout);
    allSessions.push(...sessions);
  }

  log.debug('DTD discovery: found apps', { count: allSessions.length });
  return allSessions;
}

export { parseDtdList, findDartSdkPath };

export async function enumerateProcesses(log: Logger): Promise<ProcessInfo[]> {
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
