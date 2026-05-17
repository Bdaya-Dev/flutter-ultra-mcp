// Path resolver — where on disk our state files live.
//
// Honors CLAUDE_PLUGIN_DATA (set by Claude Code for plugins) with sensible
// per-OS defaults so the package also works in development and tests.

import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export function pluginDataDir(): string {
  const env = process.env.CLAUDE_PLUGIN_DATA ?? process.env.FLUTTER_ULTRA_DATA_DIR;
  if (env) return env;
  if (process.platform === 'win32') {
    const appData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(appData, 'flutter-ultra-mcp');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'flutter-ultra-mcp');
  }
  const xdg = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(xdg, 'flutter-ultra-mcp');
}

export function stateDir(): string {
  return join(pluginDataDir(), 'state');
}

export function sessionsFilePath(): string {
  return join(stateDir(), 'sessions.json');
}

export function jobsDir(): string {
  return join(stateDir(), 'jobs');
}

export function jobFilePath(jobId: string): string {
  return join(jobsDir(), `${jobId}.json`);
}

export function streamsDir(): string {
  return join(stateDir(), 'streams');
}

export function streamFilePath(streamId: string): string {
  return join(streamsDir(), `${streamId}.jsonl`);
}

export function locksDir(): string {
  return join(stateDir(), 'locks');
}

export function tmpStateDir(): string {
  // Used only by tests / cleanup helpers.
  return join(tmpdir(), 'flutter-ultra-mcp-state');
}
