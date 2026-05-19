// Pre-launch port cleanup: detect and kill orphan processes holding a port.
// Fixes #74: orphan Chrome/dartvm processes block subsequent launches with
// errno 10048 (EADDRINUSE).

import { execFile } from 'node:child_process';

export interface PortHolder {
  pid: number;
  command?: string;
}

/**
 * Find processes listening on a TCP port.
 * Cross-platform: uses `netstat -ano` on Windows, `lsof` on Unix.
 */
export async function findListenersOnPort(port: number): Promise<PortHolder[]> {
  if (process.platform === 'win32') {
    return findListenersWindows(port);
  }
  return findListenersUnix(port);
}

function findListenersWindows(port: number): Promise<PortHolder[]> {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      const holders: PortHolder[] = [];
      const seen = new Set<number>();
      for (const line of stdout.split('\n')) {
        // Match lines like: TCP  0.0.0.0:4200  0.0.0.0:0  LISTENING  12345
        const m = line.match(
          /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i,
        );
        if (m && parseInt(m[1]!, 10) === port) {
          const pid = parseInt(m[2]!, 10);
          if (pid > 0 && !seen.has(pid)) {
            seen.add(pid);
            holders.push({ pid });
          }
        }
      }
      resolve(holders);
    });
  });
}

function findListenersUnix(port: number): Promise<PortHolder[]> {
  return new Promise((resolve) => {
    execFile('lsof', ['-i', `:${port}`, '-t', '-sTCP:LISTEN'], (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      const holders: PortHolder[] = [];
      const seen = new Set<number>();
      for (const line of stdout.trim().split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (pid > 0 && !seen.has(pid)) {
          seen.add(pid);
          holders.push({ pid });
        }
      }
      resolve(holders);
    });
  });
}

/**
 * Kill a process by PID. Returns true if the signal was sent.
 */
export function killPid(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      process.kill(pid, 'SIGKILL');
      resolve(true);
    } catch {
      // Process already exited or permission denied.
      resolve(false);
    }
  });
}

/**
 * Find and kill all processes listening on a TCP port.
 * Returns the list of PIDs that were signalled.
 */
export async function freePort(
  port: number,
  log?: (msg: string) => void,
): Promise<number[]> {
  const holders = await findListenersOnPort(port);
  if (holders.length === 0) return [];

  const killed: number[] = [];
  for (const h of holders) {
    log?.(`killing orphan process ${h.pid} holding port ${port}`);
    const ok = await killPid(h.pid);
    if (ok) killed.push(h.pid);
  }

  if (killed.length > 0) {
    // Brief pause to let the OS release the socket.
    await new Promise((r) => setTimeout(r, 500));
  }
  return killed;
}
