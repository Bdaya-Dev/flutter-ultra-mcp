// Tiny platform helpers so handlers can stay synchronous and tests can
// inject overrides without monkey-patching node:os globally.

import { platform } from 'node:os';

export function isWindows(p: NodeJS.Platform = platform()): boolean {
  return p === 'win32';
}

export function isMacOS(p: NodeJS.Platform = platform()): boolean {
  return p === 'darwin';
}

export function isLinux(p: NodeJS.Platform = platform()): boolean {
  return p === 'linux';
}
