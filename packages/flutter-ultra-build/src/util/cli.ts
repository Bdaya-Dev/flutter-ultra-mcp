/**
 * Resolve `dart` / `flutter` CLI binaries across Win/Mac/Linux.
 *
 * Order:
 *   1. env override (`FLUTTER_ULTRA_FLUTTER_BIN`, `FLUTTER_ULTRA_DART_BIN`)
 *   2. PATH lookup via `where` / `which`
 *   3. error
 *
 * Results are cached for the lifetime of the process; CLI installation
 * changes mid-session require a restart (acceptable trade-off).
 */

import { spawnSync } from 'node:child_process';
import { FlutterCliMissingError } from '../runtime/errors.js';

const cache = new Map<'dart' | 'flutter', string>();

function whichSync(cmd: string): string | undefined {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(tool, [cmd], { encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return undefined;
  const lines = res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines[0];
}

export function resolveCli(cli: 'dart' | 'flutter'): string {
  const cached = cache.get(cli);
  if (cached) return cached;
  const envKey = cli === 'dart' ? 'FLUTTER_ULTRA_DART_BIN' : 'FLUTTER_ULTRA_FLUTTER_BIN';
  const override = process.env[envKey];
  if (override && override.length > 0) {
    cache.set(cli, override);
    return override;
  }
  const found = whichSync(cli);
  if (!found) throw new FlutterCliMissingError(cli);
  cache.set(cli, found);
  return found;
}

/** Reset cached lookups (test-only). */
export function _resetCliCache(): void {
  cache.clear();
}
