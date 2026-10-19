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

/**
 * Thrown by a caller that needs CERTAINTY a previous launch's process
 * tree is dead before doing anything else — specifically the dedup
 * supersede in `launchApp.ts`'s `start()`, which must never spawn a
 * SECOND tree while the first might still be alive (hac#545's exact
 * symptom). Distinguishes "we tried, twice, and still can't confirm it"
 * from any other unexpected error, so that specific caller can refuse to
 * proceed instead of logging a warning and launching anyway.
 */
export class PreviousTreeNotConfirmedDeadError extends Error {
  constructor(
    public readonly pid: number,
    reason: string,
  ) {
    super(
      `could not confirm the previous launch's process tree (root pid ${pid}) is dead: ${reason}`,
    );
    this.name = 'PreviousTreeNotConfirmedDeadError';
  }
}

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
  // Comparable epoch-ish milliseconds, used ONLY for ORDERING (never for
  // identity — that's `startKey`): see `collectDescendants`'s stale-ppid
  // guard. `NaN` when unknown/unparseable, which that guard treats as
  // "cannot verify" and excludes.
  startTimeMs: number;
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
    "Get-CimInstance Win32_Process | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.ParentProcessId.ToString() + '|' + $_.CreationDate.ToFileTimeUtc().ToString() + '|' + ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds().ToString() }";
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
    if (parts.length !== 4) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const startKey = parts[2]!;
    const startTimeMs = Number(parts[3]);
    if (Number.isFinite(pid) && Number.isFinite(ppid)) {
      out.push({ pid, ppid, startKey, startTimeMs });
    }
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
    // `lstart`'s own rendering (e.g. "Mon Oct 19 20:14:57 2026", the
    // common ctime-style format both GNU and BSD `ps` use) is one of the
    // legacy formats `Date.parse` is built to accept — used ONLY to get a
    // comparable ordering value; `startKey` above stays the untouched raw
    // string for identity. `NaN` on an unrecognized rendering is handled
    // by the ordering guard that reads this (fail-safe: treated as
    // "unknown", never as "equal" or "earlier").
    const startTimeMs = Date.parse(startKey);
    if (Number.isFinite(pid) && Number.isFinite(ppid))
      out.push({ pid, ppid, startKey, startTimeMs });
  }
  return out;
}

export async function getProcessStartKey(pid: number): Promise<string | undefined> {
  const all = await listAllProcesses();
  return all.find((p) => p.pid === pid)?.startKey;
}

/**
 * Walks the live ppid chain from `rootPid` to collect its descendants —
 * guarded against the two failure modes a stale/reused PID creates on a
 * platform (Windows) that never reparents orphans, per Microsoft's own
 * .NET Aspire orchestrator (DCP) fixing exactly this in its process-tree
 * code: "PIDs are reusable. On Windows, a stale parent PID can point at
 * an unrelated process and create a cycle during process-tree traversal,
 * causing resource shutdown to hang and potentially selecting the wrong
 * process for termination." (microsoft/dcp#274, "Windows PID reuse can
 * hang resource shutdown"). Their fix, matched here:
 *
 * 1. A VISITED SET, so a cycle (A's stale ParentProcessId points at B,
 *    B's points back at A — both now unrelated to the pids they used to
 *    mean) terminates the walk instead of looping forever.
 * 2. "Check process creation times to reject stale parent relationships"
 *    (same issue) — a process can never predate its own parent, so a
 *    candidate child is accepted only when `child.startTimeMs >=
 *    parent.startTimeMs`. Per #274 itself: "A cycle guard alone is
 *    insufficient: it could still leave unrelated processes in the list
 *    to kill" — the ordering check is what actually rejects an unrelated
 *    process X whose ParentProcessId field still shows our root's PID
 *    only because that number got reused after X's REAL (different,
 *    long-exited) parent held it. Landed upstream in microsoft/dcp#278
 *    ("Make process handling PID-reuse safe and remove gopsutil" —
 *    "build process trees from platform snapshots while validating
 *    parent/child creation order, duplicate or ambiguous PIDs, and
 *    ancestry cycles").
 *
 * An unparseable/unknown `startTimeMs` (`NaN`) fails SAFE: excluded, same
 * as a provably-too-old one — better to leave a real descendant unkilled
 * in a rare edge case than kill an unrelated process on an unverifiable
 * guess.
 */
export function collectDescendants(all: ProcessSnapshot[], rootPid: number): ProcessSnapshot[] {
  const byPpid = new Map<number, ProcessSnapshot[]>();
  for (const p of all) {
    const list = byPpid.get(p.ppid);
    if (list) list.push(p);
    else byPpid.set(p.ppid, [p]);
  }
  const root = all.find((p) => p.pid === rootPid);
  if (!root) return [];
  const result: ProcessSnapshot[] = [root];
  const visited = new Set<number>([rootPid]);
  const queue: ProcessSnapshot[] = [root];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of byPpid.get(parent.pid) ?? []) {
      if (visited.has(child.pid)) continue; // cycle guard
      if (
        Number.isNaN(child.startTimeMs) ||
        Number.isNaN(parent.startTimeMs) ||
        child.startTimeMs < parent.startTimeMs
      ) {
        continue; // stale-ppid guard: a child cannot predate its parent
      }
      visited.add(child.pid);
      result.push(child);
      queue.push(child);
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

export interface KillTreeResult {
  killed: number[];
  // true only when we got a FRESH live listing, found the root in it
  // (verifying its identity when `expectedStartKey` is given), and walked
  // ITS descendants from that same listing — i.e. there is nothing else
  // discoverable that we didn't account for. false whenever the listing
  // itself failed (no `pwsh`/`powershell.exe`, or it timed out): we still
  // make a best-effort kill of the recorded root PID directly (never
  // "nothing killed" just because we lost visibility), but descendants
  // may be alive and unaccounted for — a caller that needs to be SURE
  // the whole tree is dead (the dedup path in index.ts, guarding against
  // hac#545's exact "a second tree gets launched while the first is still
  // alive" symptom) must treat `confident: false` as "not yet confirmed",
  // not as success.
  confident: boolean;
}

/**
 * Kill `rootPid` and every CURRENT descendant of it, verified against the
 * live process table — never `taskkill /T`, never by image name.
 *
 * - If the process-table LISTING ITSELF fails (no `pwsh`/`powershell.exe`
 *   on PATH, or it times out), there is no tree to walk at all — still
 *   makes a best-effort `process.kill(rootPid, 'SIGKILL')` on the
 *   recorded PID directly and reports `confident: false`.
 * - If `rootPid` isn't found in a listing that DID succeed (already
 *   exited, or our tracking is stale), also falls back to that same
 *   best-effort single-PID kill — a safe no-op if it's already gone —
 *   but reports `confident: true`: a full, successful listing that
 *   simply doesn't contain this pid is real information, not a gap.
 * - If `expectedStartKey` is given and doesn't match the live process at
 *   `rootPid`, the PID has been reused by an unrelated process since it
 *   was recorded — this never touches it (`confident: true`: we got a
 *   full listing and correctly determined this isn't our process).
 */
export async function killProcessTreeVerified(
  rootPid: number,
  expectedStartKey?: string,
): Promise<KillTreeResult> {
  let all: ProcessSnapshot[];
  try {
    all = await listAllProcesses();
  } catch {
    const killed: number[] = [];
    try {
      process.kill(rootPid, 'SIGKILL');
      killed.push(rootPid);
    } catch {
      // Already gone, or no permission — nothing more we can do without
      // a listing to walk descendants from.
    }
    return { killed, confident: false };
  }
  const root = all.find((p) => p.pid === rootPid);
  if (!root) {
    try {
      process.kill(rootPid, 'SIGKILL');
      return { killed: [rootPid], confident: true };
    } catch {
      return { killed: [], confident: true };
    }
  }
  if (expectedStartKey !== undefined && root.startKey !== expectedStartKey) {
    return { killed: [], confident: true };
  }
  const tree = collectDescendants(all, rootPid);
  return { killed: killBottomUp(tree), confident: true };
}
