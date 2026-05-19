// patrol_doctor — run `dart run patrol_cli doctor` and return structured results.

import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { z } from 'zod';
import { defineTool } from './types.js';
import { findFlutterProject } from '../runtime/project.js';

interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
}

function parsePatrolDoctorOutput(output: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  // patrol doctor emits lines like:
  //   [✓] Flutter toolchain (flutter 3.x.x)
  //   [✗] Patrol CLI (not found)
  //   [!] Android toolchain (SDK missing)
  const lineRe = /^\s*\[([✓✗!x])\]\s*(.+)$/u;
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(lineRe);
    if (!m) continue;
    const marker = m[1]!;
    const rest = m[2]!.trim();
    // Extract name (before parenthetical) and message (parenthetical, if any)
    const parenIdx = rest.indexOf('(');
    const name = parenIdx > -1 ? rest.slice(0, parenIdx).trim() : rest;
    const message =
      parenIdx > -1
        ? rest
            .slice(parenIdx + 1, rest.lastIndexOf(')') > -1 ? rest.lastIndexOf(')') : undefined)
            .trim()
        : '';
    const passed = marker === '✓';
    checks.push({ name, passed, message });
  }
  return checks;
}

export const patrolDoctorTool = defineTool({
  name: 'run_patrol_doctor',
  description:
    'Run patrol doctor to validate the testing environment. Returns structured results for each check.',
  inputSchema: z.object({
    projectRoot: z.string().min(1).describe('Absolute path to the Flutter project root.'),
  }),
  handler(input): Promise<unknown> {
    const project = findFlutterProject(input.projectRoot);
    const dartCmd = platform() === 'win32' ? 'dart.bat' : 'dart';

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const child = spawn(dartCmd, ['run', 'patrol_cli', 'doctor'], {
        cwd: project.root,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        const combined = stdout + stderr;
        const checks = parsePatrolDoctorOutput(combined);
        resolve({
          ok: code === 0,
          exitCode: code,
          checks,
          rawOutput: combined.trim(),
        });
      });

      child.on('error', (err) => {
        resolve({
          ok: false,
          exitCode: null,
          checks: [],
          rawOutput: '',
          error: err.message,
        });
      });
    });
  },
});
