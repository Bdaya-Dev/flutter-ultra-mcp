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

import { spawn } from 'node:child_process';

// Bounds every process-table read. This must never hang a caller — a dedup
// kill or stop() escalation has to make progress either way. 60s covers
// the slowest case MEASURED live on GitHub Actions windows-latest CI: the
// `powershell.exe` (Windows PowerShell 5.1) fallback path below took
// 23-37s just to start and run ANY script (even `Write-Output 1`), while
// `pwsh` (PowerShell 7) ran the identical invocations in under a second —
// see `listAllWindows`'s doc comment. POSIX `ps` and the `pwsh` path are
// both well under 1s locally; this bound exists for the rare host that
// lacks `pwsh` and hits that slow path.
const LIST_TIMEOUT_MS = 60_000;

/**
 * Runs `command` and collects stdout, with stdin explicitly NOT a pipe.
 *
 * `child_process.exec`/`execFile` always create a pipe for the child's
 * stdin (confirmed empirically: passing `stdio: ['ignore', ...]` to
 * `execFile` has no effect — `child.stdin` is still a connected Socket) —
 * and NEVER close or write to it, since neither API exposes a way to. A
 * pipe's write end stays open until something closes it; a child that
 * ever tries to read its own stdin blocks forever waiting for EOF that
 * never arrives. This is a documented Node.js/Windows-process hang class
 * (nodejs/node#25645 — `exec`/`execFile`/`spawn` of `powershell.exe` never
 * returning; fixed upstream in nodejs/citgm@595dcf64 by setting
 * `stdio: ['ignore', 'pipe', 'ignore']` on the `spawn()` call). `spawn()`
 * is the one API that actually honors a per-fd `stdio` override, so it's
 * used here instead, with stdin set to `'ignore'` (connected to the OS
 * null device, which reads as immediate EOF rather than blocking) so the
 * child can never wait on input we were never going to provide anyway.
 * This closes that specific gap but turned out NOT to be the cause of the
 * GitHub Actions windows-latest CI timeouts on its own — see
 * `listAllWindows`'s doc comment for the measured actual cause. Kept
 * regardless: it's still a real, documented hang class worth closing.
 */
function runCommand(command: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: LIST_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited code=${code ?? 'null'} signal=${signal ?? 'null'}: ${stderr}`,
          ),
        );
        return;
      }
      resolve({ stdout });
    });
  });
}

export interface ProcessSnapshot {
  pid: number;
  ppid: number;
  // Opaque per-platform "this is still the SAME process" identity — never
  // parsed as a date, only ever compared for equality. Resolution varies:
  // sub-microsecond on Windows (CIM `CreationDate`), ONE SECOND on POSIX
  // (`ps`'s `lstart` — both GNU and BSD `ps` cap out there). Two processes
  // that happen to start within the same calendar second on POSIX will
  // compare equal here even though they're different processes — a
  // deliberate, accepted trade-off: the threat this guards against is a
  // PID recorded possibly minutes/hours earlier being reused by an
  // unrelated process, and that unrelated process landing in the EXACT
  // SAME SECOND as the original recording is not a realistic collision.
  startKey: string;
}

export async function listAllProcesses(): Promise<ProcessSnapshot[]> {
  return process.platform === 'win32' ? listAllWindows() : listAllUnix();
}

// Windows: PowerShell CIM (WMIC is deprecated / removed on newer builds).
// `CreationDate.ToFileTimeUtc()` is a stable integer identity for "this
// exact process instance" — cheap to compare, no datetime parsing needed.
//
// The script is passed via `-EncodedCommand` (base64 UTF-16LE) — the
// mechanism PowerShell's own docs name for commands needing "complex
// quotation marks or curly braces" — so there's no shell-quoting layer:
// no cmd.exe reinterpreting embedded quotes, no risk of a malformed
// command line.
//
// Prefers `pwsh` (PowerShell 7, preinstalled on GitHub's windows-latest
// image since ~2020) over `powershell.exe` (Windows PowerShell 5.1),
// falling back to the latter only when `pwsh` isn't on PATH — this tool
// also runs on real end-user Windows machines outside CI, where `pwsh`
// isn't guaranteed. MEASURED live on GitHub Actions windows-latest CI
// (both Node 20 and 22, run 39291426471): `powershell.exe` took
// 23191-36653ms to run EITHER a trivial `Write-Output 1` OR this exact
// CIM query — both equally slow, which is what shows the cost is
// `powershell.exe`'s own startup (its stderr carries a
// "Preparing modules for first use" progress record — first-use module
// discovery/caching), not the CIM/WMI call itself. `pwsh` ran the
// IDENTICAL CIM query on the same runner in 687ms. This was the real
// cause of every `processTree.test.ts` test timing out at its own budget
// there — not a hang (every run DID complete, with `code=0`), and not the
// stdin-pipe gap `runCommand` already closes (that was real but
// insufficient on its own, confirmed by this same measurement still
// being slow after it landed).
async function listAllWindows(): Promise<ProcessSnapshot[]> {
  const script =
    "Get-CimInstance Win32_Process | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.ParentProcessId.ToString() + '|' + $_.CreationDate.ToFileTimeUtc().ToString() }";
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded,
  ];
  let stdout: string;
  try {
    ({ stdout } = await runCommand('pwsh', args));
  } catch (err) {
    // ENOENT = pwsh isn't installed on this host — fall back. Any other
    // error (a real pwsh failure) is NOT papered over by silently
    // retrying under a different shell; it propagates as-is.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    ({ stdout } = await runCommand('powershell.exe', args));
  }
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
// and BSD (macOS) `ps`, unlike `etimes` which keeps ticking. See the
// `startKey` doc comment above for its resolution caveat.
async function listAllUnix(): Promise<ProcessSnapshot[]> {
  const { stdout } = await runCommand('ps', ['-eo', 'pid=,ppid=,lstart=']);
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
