// TEMPORARY diagnostic for PR #167 / hac#545 (removed before the final
// push). windows-latest CI has every processTree.test.ts test timing out
// at exactly its own budget (15s), even after switching the process-table
// read from exec/execFile to spawn with stdio: ['ignore', 'pipe', 'pipe']
// (closing the known execFile-stdin-pipe hang class, nodejs/node#25645).
// A UNIFORM timeout on every call points at a consistent block, not WMI
// cold-start slowness. This measures, on the real CI runner, in one round:
//   - does `powershell.exe` even start and exit at all (trivial script)?
//   - does it specifically block on the `Get-CimInstance Win32_Process`
//     query (the CIM/WMI call), or on the shell itself?
//   - does `pwsh` (PowerShell 7, preinstalled on GH's windows-latest
//     image) behave differently from `powershell.exe` (Windows PowerShell
//     5.1) for the same two scripts?
//   - what PowerShell version is actually running the job?
// This is read-only logging — every case uses a generous 60s timeout and
// `it.skipIf` so a hang doesn't block the rest of the suite, and nothing
// here asserts; it only reports via console.error (visible in CI logs
// regardless of pass/fail).

import { spawn } from 'node:child_process';
import { describe, it } from 'vitest';

const isWindows = process.platform === 'win32';

interface RunResult {
  elapsedMs: number;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdoutHead: string;
  stderrHead: string;
  errorMessage?: string;
}

function runDiagnostic(command: string, args: string[], timeoutMs: number): Promise<RunResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < 500) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 500) stderr += d.toString('utf8');
    });
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on('error', (err) => {
      finish({
        elapsedMs: Date.now() - t0,
        code: null,
        signal: null,
        stdoutHead: stdout.slice(0, 500),
        stderrHead: stderr.slice(0, 500),
        errorMessage: err.message,
      });
    });
    child.on('close', (code, signal) => {
      finish({
        elapsedMs: Date.now() - t0,
        code,
        signal,
        stdoutHead: stdout.slice(0, 500),
        stderrHead: stderr.slice(0, 500),
      });
    });
  });
}

const CIM_SCRIPT =
  "Get-CimInstance Win32_Process | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.ParentProcessId.ToString() + '|' + $_.CreationDate.ToFileTimeUtc().ToString() }";
const TRIVIAL_SCRIPT = 'Write-Output 1';
const VERSION_SCRIPT = '$PSVersionTable.PSVersion.ToString()';

function encode(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function psArgs(script: string): string[] {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encode(script),
  ];
  console.error('[diag] argv for this run:', JSON.stringify(args));
  return args;
}

async function report(label: string, command: string, script: string): Promise<void> {
  const result = await runDiagnostic(command, psArgs(script), 60_000);
  console.error(
    `[diag] ${label} -- elapsedMs=${result.elapsedMs} code=${result.code} signal=${result.signal} ` +
      `error=${result.errorMessage ?? 'none'}\n` +
      `[diag] ${label} stdoutHead=${JSON.stringify(result.stdoutHead)}\n` +
      `[diag] ${label} stderrHead=${JSON.stringify(result.stderrHead)}`,
  );
}

function hasPwsh(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      timeout: 10_000,
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

describe.skipIf(!isWindows)('WINDOWS DIAGNOSTIC (temporary, hac#545 / PR #167)', () => {
  it('powershell.exe: version + trivial script + CIM query', async () => {
    await report('powershell.exe version', 'powershell.exe', VERSION_SCRIPT);
    await report('powershell.exe trivial', 'powershell.exe', TRIVIAL_SCRIPT);
    await report('powershell.exe CIM', 'powershell.exe', CIM_SCRIPT);
  }, 200_000);

  it('pwsh (PowerShell 7, if present): version + trivial script + CIM query', async () => {
    const present = await hasPwsh();
    console.error('[diag] pwsh present on PATH:', present);
    if (!present) return;
    await report('pwsh version', 'pwsh', VERSION_SCRIPT);
    await report('pwsh trivial', 'pwsh', TRIVIAL_SCRIPT);
    await report('pwsh CIM', 'pwsh', CIM_SCRIPT);
  }, 200_000);
});
