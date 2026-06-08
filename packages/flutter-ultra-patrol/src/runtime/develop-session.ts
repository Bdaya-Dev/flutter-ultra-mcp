// Single warm patrol-develop session per server process.
//
// patrol_cli's `develop` command runs an interactive Flutter app with the
// Patrol test harness attached. Commands are read from stdin:
//   r   — hot-reload
//   R   — hot-restart
//   q   — quit
//   t <name>  — run named test (bdaya fork extension surfaced via MCP)
//
// Plan §17B.1 marks start_patrol_develop as MARATHON. Only one develop
// session can be active per project at a time; second start returns the
// existing one with kind='reused'.

import type { PatrolJobRecord } from './job-store.js';

export class DevelopSessionManager {
  private current: PatrolJobRecord | null = null;
  lastTestFile: string | null = null;
  lastRecordingPath: string | null = null;

  /** Returns the current warm session, or null if none. */
  get(): PatrolJobRecord | null {
    return this.current && this.current.child ? this.current : null;
  }

  /**
   * Registers a newly-spawned develop child as the current session. The
   * caller has already invoked {@link JobStore.attachChild} so the child
   * is wired for stdout/stderr buffering.
   */
  register(record: PatrolJobRecord): void {
    if (this.current && this.current.child) {
      throw new Error(
        `develop session already active (job ${this.current.id}); call patrol_develop_quit first`,
      );
    }
    this.current = record;
    this.lastTestFile = null;
    this.lastRecordingPath = null;
  }

  /**
   * Sends a command to the develop child's stdin. Returns true if written;
   * false if no session exists or stdin is closed.
   */
  send(command: string): boolean {
    const child = this.current?.child;
    if (!child || !child.stdin || child.stdin.destroyed) return false;
    const payload = command.endsWith('\n') ? command : `${command}\n`;
    return child.stdin.write(payload);
  }

  setTestFile(testFile: string): void {
    this.lastTestFile = testFile;
  }

  setRecordingPath(path: string): void {
    this.lastRecordingPath = path;
  }

  /** Clears the current pointer (called by tool handlers on quit / exit). */
  clear(): void {
    this.current = null;
    this.lastTestFile = null;
    this.lastRecordingPath = null;
  }
}
