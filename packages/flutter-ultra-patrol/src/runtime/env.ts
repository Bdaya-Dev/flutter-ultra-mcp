// Environment resolution for the flutter-ultra-patrol MCP server.
//
// Reads FLUTTER_ULTRA_* and PATROL_* env vars that .mcp.json injects.
// Centralising here keeps tool handlers free of process.env lookups so
// unit tests can inject overrides cleanly.

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export interface PatrolServerEnv {
  /**
   * Directory containing the vendored Bdaya patrol fork. From
   * .mcp.json: FLUTTER_ULTRA_PATROL_FORK=${CLAUDE_PLUGIN_ROOT}/vendor/patrol.
   * Empty if the env was not injected (e.g. running unit tests without the
   * plugin host).
   */
  patrolForkPath: string;

  /**
   * State directory for marathon-tool job records. From .mcp.json:
   * FLUTTER_ULTRA_STATE_DIR=${CLAUDE_PLUGIN_DATA}/state.
   */
  stateDir: string;

  /**
   * Comma-separated browser args injected into PATROL_WEB_BROWSER_ARGS by
   * .mcp.json. Per Invora gotcha #10 the default contains
   * --enable-unsafe-swiftshader plus throttling-off flags. Empty string is
   * a valid value when the user explicitly clears it.
   */
  webBrowserArgs: string;

  /**
   * Log-level override. Defaults to 'info'.
   */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): PatrolServerEnv {
  const patrolForkPath = env.FLUTTER_ULTRA_PATROL_FORK ?? '';
  const stateDir = env.FLUTTER_ULTRA_STATE_DIR ?? '';
  const webBrowserArgs = env.PATROL_WEB_BROWSER_ARGS ?? '';
  const rawLevel = env.FLUTTER_ULTRA_LOG_LEVEL;
  const logLevel = isLogLevel(rawLevel) ? rawLevel : 'info';
  return { patrolForkPath, stateDir, webBrowserArgs, logLevel };
}

function isLogLevel(v: string | undefined): v is PatrolServerEnv['logLevel'] {
  return v === 'debug' || v === 'info' || v === 'warn' || v === 'error';
}

/**
 * Resolves a project-relative path to absolute against the given root.
 * Absolute paths are returned unchanged.
 */
export function resolveFromProject(projectRoot: string, p: string): string {
  if (isAbsolute(p)) return p;
  return resolve(projectRoot, p);
}

/**
 * Returns the absolute path to the bundled patrol_cli binary inside the
 * vendored fork. Used as the fallback when the project does NOT have its
 * own patrol_cli dev-dep wired up. Returns null if no fork is configured.
 */
export function resolveBundledPatrolCli(env: PatrolServerEnv): string | null {
  if (!env.patrolForkPath) return null;
  const candidate = join(env.patrolForkPath, 'packages', 'patrol_cli', 'bin', 'main.dart');
  if (!existsSync(candidate)) return null;
  return candidate;
}
