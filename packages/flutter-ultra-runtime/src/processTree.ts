// Verified process-tree teardown (hac#545 follow-up).
//
// `launch_app`'s dedup kill (`stopLiveSession` in index.ts) and `stop()`'s
// SIGKILL escalation (this file's own `stop()` caller in launchApp.ts) must
// free the WHOLE process tree a launch spawned, not just the single PID we
// happened to record. On Windows, `launchApp.ts` spawns `flutter.bat` with
// `shell: true`, so the recorded PID is cmd.exe's — the real Dart tool /
// `frontend_server` / Dart VM are its descendants, several levels down, and
// a bare `process.kill(pid)` never cascades to them on ANY platform (POSIX
// SIGKILL doesn't cascade to children either, absent a process-group kill).
//
// Fix shape: at kill time, re-read the CURRENT process table, verify the
// recorded root PID is still the SAME process (by a platform-stable
// "start identity" key — never by name, never `taskkill /T`, which risks an
// unrelated process via PID reuse), walk its CURRENT descendants via the
// ppid chain, and kill bottom-up (deepest first) so a parent never gets a
// chance to orphan a not-yet-killed child onto a different parent mid-sweep.

import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

export interface ProcessSnapshot {
  pid: number;
  ppid: number;
  // Opaque per-platform "this is still the SAME process" identity — never
  // parsed as a date, only ever compared for equality.
  startKey: string;
}

export async function listAllProcesses(): Promise<ProcessSnapshot[]> {
  return process.platform === 'win32' ? listAllWindows() : listAllUnix();
}

// Windows: PowerShell CIM (WMIC is deprecated / removed on newer builds).
// `CreationDate.ToFileTimeUtc()` is a stable integer identity for "this
// exact process instance" — cheap to compare, no datetime parsing needed.
async function listAllWindows(): Promise<ProcessSnapshot[]> {
  const script =
    "Get-CimInstance Win32_Process | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.ParentProcessId.ToString() + '|' + $_.CreationDate.ToFileTimeUtc().ToString() }";
  const { stdout } = await exec(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const out: ProcessSnapshot[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length !== 3) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const startKey = parts[2]!;
    if (Number.isFinite(pid) && Number.isFinite(ppid)) out.push({ pid, ppid, startKey });
  }
  return out;
}

// POSIX: `lstart` is each `ps` implementation's own fixed "process started
// at" rendering (absolute, not elapsed) — stable between two `ps` calls
// unless the process actually restarted, and available on both GNU (Linux)
// and BSD (macOS) `ps`, unlike `etimes` which keeps ticking.
async function listAllUnix(): Promise<ProcessSnapshot[]> {
  const { stdout } = await exec('ps -eo pid=,ppid=,lstart=', { maxBuffer: 64 * 1024 * 1024 });
  const out: ProcessSnapshot[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const firstSpace = line.indexOf(' ');
    if (firstSpace < 0) continue;
    const pid = Number(line.slice(0, firstSpace));
    const rest = line.slice(firstSpace + 1).trimStart();
    const secondSpace = rest.indexOf(' ');
    if (secondSpace < 0) continue;
    const ppid = Number(rest.slice(0, secondSpace));
    const startKey = rest.slice(secondSpace + 1).trim();
    if (Number.isFinite(pid) && Number.isFinite(ppid)) out.push({ pid, ppid, startKey });
  }
  return out;
}

export async function getProcessStartKey(pid: number): Promise<string | undefined> {
  const all = await listAllProcesses();
  return all.find((p) => p.pid === pid)?.startKey;
}

function collectDescendants(all: ProcessSnapshot[], rootPid: number): ProcessSnapshot[] {
  const byPpid = new Map<number, ProcessSnapshot[]>();
  for (const p of all) {
    const list = byPpid.get(p.ppid);
    if (list) list.push(p);
    else byPpid.set(p.ppid, [p]);
  }
  const root = all.find((p) => p.pid === rootPid);
  if (!root) return [];
  const result: ProcessSnapshot[] = [root];
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const child of byPpid.get(pid) ?? []) {
      result.push(child);
      queue.push(child.pid);
    }
  }
  return result;
}

// Kill leaves first: repeatedly kill every process that is not currently a
// parent of anything else still in the set, then shrink the set, until
// nothing is left. Bounded by the set size — always terminates.
function killBottomUp(tree: ProcessSnapshot[]): number[] {
  const remaining = [...tree];
  const killed: number[] = [];
  while (remaining.length > 0) {
    const parentPids = new Set(remaining.map((p) => p.ppid));
    const leaves = remaining.filter((p) => !parentPids.has(p.pid));
    const batch = leaves.length > 0 ? leaves : remaining; // defensive: never spin forever
    for (const p of batch) {
      try {
        process.kill(p.pid, 'SIGKILL');
        killed.push(p.pid);
      } catch {
        // Already gone.
      }
      const idx = remaining.findIndex((x) => x.pid === p.pid);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }
  return killed;
}

/**
 * Kill `rootPid` and every CURRENT descendant of it, verified against the
 * live process table — never `taskkill /T`, never by image name.
 *
 * - If `rootPid` isn't found in the current snapshot at all (the listing
 *   mechanism found nothing, or the process already exited), falls back to
 *   a single best-effort `process.kill(rootPid, 'SIGKILL')` — a safe no-op
 *   if it's already gone, and no worse than the single-PID kill this
 *   replaces for a case the tree walk genuinely cannot see.
 * - If `expectedStartKey` is given and doesn't match the live process at
 *   `rootPid`, the PID has been reused by an unrelated process since it was
 *   recorded — this never touches it.
 */
export async function killProcessTreeVerified(
  rootPid: number,
  expectedStartKey?: string,
): Promise<number[]> {
  const all = await listAllProcesses();
  const root = all.find((p) => p.pid === rootPid);
  if (!root) {
    try {
      process.kill(rootPid, 'SIGKILL');
      return [rootPid];
    } catch {
      return [];
    }
  }
  if (expectedStartKey !== undefined && root.startKey !== expectedStartKey) {
    return [];
  }
  const tree = collectDescendants(all, rootPid);
  return killBottomUp(tree);
}
