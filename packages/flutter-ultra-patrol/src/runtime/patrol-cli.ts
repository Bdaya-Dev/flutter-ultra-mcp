// Patrol CLI invocation strategy.
//
// Resolution order (per plan §17B.1):
//   1. If `useRawCli` is true, skip wrapper detection.
//   2. If project has `./scripts/run_patrol_web.ps1` (Windows) or
//      `./scripts/run_patrol_web.sh` (Unix), use it — many Bdaya projects
//      pre-apply env vars + flags via this convention.
//   3. Otherwise spawn `dart run patrol_cli` from the project root. `dart`
//      transitively resolves the patrol_cli dev-dep, which pubspec_overrides
//      can pin to our vendored fork.
//
// We intentionally do NOT run patrol_cli as a global binary — dart run is
// version-pinned per project and avoids PATH drift between dev machines.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { platform } from 'node:os';
import type { FlutterProject } from './project.js';

export type PatrolInvocation =
  | {
      kind: 'wrapper-script';
      command: string;
      args: string[];
      /** Absolute path to the wrapper for diagnostics. */
      scriptPath: string;
    }
  | {
      kind: 'dart-run';
      command: string;
      args: string[];
    };

export interface BuildInvocationInput {
  project: FlutterProject;
  /** Args after `patrol` — e.g. `['test', '--target', 'foo.dart']`. */
  patrolArgs: string[];
  /** When true, skip wrapper-script detection. */
  useRawCli?: boolean;
  /**
   * Optional override pointing at a known wrapper script. Tests pass this
   * to avoid touching the filesystem.
   */
  knownWrapperPath?: string;
}

const WRAPPER_NAMES_WINDOWS = ['run_patrol_web.ps1', 'run_patrol.ps1'];
const WRAPPER_NAMES_POSIX = ['run_patrol_web.sh', 'run_patrol.sh'];

/**
 * Compute the spawn command + args for one patrol_cli invocation. Pure
 * over filesystem reads via {@link existsSync} so a `useRawCli` short-circuit
 * is the deterministic test path.
 */
export function buildPatrolInvocation(input: BuildInvocationInput): PatrolInvocation {
  const { project, patrolArgs, useRawCli, knownWrapperPath } = input;

  if (!useRawCli) {
    const wrapper = knownWrapperPath ?? detectWrapperScript(project.root);
    if (wrapper) {
      return invocationFromWrapper(wrapper, patrolArgs);
    }
  }

  const dartCmd = platform() === 'win32' ? 'dart.bat' : 'dart';
  return {
    kind: 'dart-run',
    command: dartCmd,
    args: ['run', 'patrol_cli', ...patrolArgs],
  };
}

function detectWrapperScript(projectRoot: string): string | null {
  const isWin = platform() === 'win32';
  const names = isWin ? WRAPPER_NAMES_WINDOWS : WRAPPER_NAMES_POSIX;
  for (const name of names) {
    const candidate = resolve(projectRoot, 'scripts', name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function patrolArgsToWrapperArgs(patrolArgs: string[]): string[] {
  const wrapperArgs: string[] = [];
  for (let i = 0; i < patrolArgs.length; i++) {
    const arg = patrolArgs[i]!;
    if (arg === 'test' || arg === 'develop') continue;
    if (arg === '--target' || arg === '-t') {
      const next = patrolArgs[i + 1];
      if (next) {
        wrapperArgs.push('-Target', next);
        i++;
      }
      continue;
    }
    if (arg.startsWith('--target=')) {
      wrapperArgs.push('-Target', arg.slice('--target='.length));
      continue;
    }
    wrapperArgs.push(arg);
  }
  return wrapperArgs;
}

function invocationFromWrapper(scriptPath: string, patrolArgs: string[]): PatrolInvocation {
  if (scriptPath.toLowerCase().endsWith('.ps1')) {
    return {
      kind: 'wrapper-script',
      command: 'pwsh',
      args: ['-NoLogo', '-NoProfile', '-File', scriptPath, ...patrolArgsToWrapperArgs(patrolArgs)],
      scriptPath,
    };
  }
  return {
    kind: 'wrapper-script',
    command: 'sh',
    args: [scriptPath, ...patrolArgs],
    scriptPath,
  };
}
