/**
 * Analysis & format tools (plan §5.1 — Analysis & formatting section):
 *
 *   analyze, format, fix, fix_preview, flutter_doctor, flutter_clean, pub_cache_repair
 *
 * Output shapes:
 * - analyze   → {diagnostics: [{path, line, col, severity, code, message}], summary}
 * - format    → {changedFiles: [...], unchangedCount, totalSeen}
 * - fix       → {fixedFiles: count, byKind: {...}}
 * - fix_preview → structured before/after for each touched file
 * - flutter_doctor → parsed sections + warning list
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err, errFromException } from '../runtime/result.js';
import { spawnCapture } from '../runtime/spawn.js';
import { resolveCli } from '../util/cli.js';
import { loadProject } from '../util/project.js';

const rootArg = z
  .string()
  .min(1)
  .describe('Absolute path to a Flutter/Dart project root or descendant.');

export function register(server: McpServer): void {
  defineTool<{ root: string; targets?: string[] }>(server, {
    name: 'analyze',
    description:
      'Run `dart analyze` and return structured diagnostics (path/line/col/severity/code/message).',
    inputSchema: {
      root: rootArg,
      targets: z
        .array(z.string().min(1))
        .optional()
        .describe('Relative paths within the project to analyze. Default: project root.'),
    },
    watchdog: { name: 'analyze', ceilingMs: 5 * 60_000, toolClass: 'long' },
    handler: async ({ root, targets }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli('dart');
        const args = ['analyze', '--format', 'json', ...(targets ?? [])];
        let filesSeen = 0;
        const result = await spawnCapture({
          cmd: cli,
          args,
          cwd: proj.root,
          timeoutMs: 5 * 60_000,
          signal: ctx.signal,
          onStdoutLine: () => {
            filesSeen++;
            if (filesSeen % 50 === 0)
              ctx.sendProgress({ progress: filesSeen, message: `lines processed: ${filesSeen}` });
          },
        });
        const diagnostics = parseDartAnalyzeJson(result.stdout);
        return okJson({
          diagnostics,
          summary: {
            total: diagnostics.length,
            errors: diagnostics.filter((d) => d.severity === 'ERROR').length,
            warnings: diagnostics.filter((d) => d.severity === 'WARNING').length,
            infos: diagnostics.filter((d) => d.severity === 'INFO').length,
          },
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });
      } catch (e) {
        return errFromException(
          e,
          'Verify the `dart` CLI is installed and the project has a valid pubspec.yaml.',
        );
      }
    },
  });

  defineTool<{ root: string; targets?: string[]; setExitIfChanged?: boolean }>(server, {
    name: 'format',
    description: 'Run `dart format` over the project. Returns changed-file list.',
    inputSchema: {
      root: rootArg,
      targets: z
        .array(z.string().min(1))
        .optional()
        .describe('Relative paths; defaults to project root.'),
      setExitIfChanged: z
        .boolean()
        .optional()
        .default(false)
        .describe('Pass --set-exit-if-changed; useful for CI parity checks.'),
    },
    watchdog: { name: 'format', ceilingMs: 5 * 60_000, toolClass: 'long' },
    handler: async ({ root, targets, setExitIfChanged }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli('dart');
        const args = [
          'format',
          '--output',
          'show',
          ...(setExitIfChanged ? ['--set-exit-if-changed'] : []),
          ...(targets ?? ['.']),
        ];
        const result = await spawnCapture({
          cmd: cli,
          args,
          cwd: proj.root,
          timeoutMs: 5 * 60_000,
          signal: ctx.signal,
        });
        // `dart format --output show` prints a summary line like `Formatted 24 files (3 changed) in N.Ns.`
        const summary = parseFormatSummary(result.stdout);
        const changed = parseFormatChangedFiles(result.stdout);
        return okJson({
          changedFiles: changed,
          summary,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdoutTail: tail(result.stdout, 4 * 1024),
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'fix',
    description: 'Run `dart fix --apply` to apply quick fixes. Returns count by kind.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'fix', ceilingMs: 3 * 60_000, toolClass: 'long' },
    handler: async ({ root }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli('dart');
        const result = await spawnCapture({
          cmd: cli,
          args: ['fix', '--apply'],
          cwd: proj.root,
          timeoutMs: 3 * 60_000,
          signal: ctx.signal,
        });
        return okJson({
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdoutTail: tail(result.stdout, 16 * 1024),
          stderrTail: tail(result.stderr, 4 * 1024),
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'fix_preview',
    description:
      'Run `dart fix --dry-run` to preview quick fixes without applying. Returns the diff summary.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'fix_preview', ceilingMs: 3 * 60_000, toolClass: 'long' },
    handler: async ({ root }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli('dart');
        const result = await spawnCapture({
          cmd: cli,
          args: ['fix', '--dry-run'],
          cwd: proj.root,
          timeoutMs: 3 * 60_000,
          signal: ctx.signal,
        });
        return okJson({
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          dryRunOutput: result.stdout,
          stderrTail: tail(result.stderr, 4 * 1024),
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ verbose?: boolean }>(server, {
    name: 'flutter_doctor',
    description: 'Run `flutter doctor -v` and return parsed sections + warning list.',
    inputSchema: {
      verbose: z.boolean().optional().default(true),
    },
    watchdog: { name: 'flutter_doctor', ceilingMs: 60_000, toolClass: 'long' },
    handler: async ({ verbose }, ctx) => {
      try {
        const cli = resolveCli('flutter');
        const result = await spawnCapture({
          cmd: cli,
          args: verbose ? ['doctor', '-v'] : ['doctor'],
          cwd: process.cwd(),
          timeoutMs: 60_000,
          signal: ctx.signal,
        });
        return okJson({
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          sections: parseDoctorSections(result.stdout),
          rawOutput: result.stdout,
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'flutter_clean',
    description: 'Run `flutter clean` to remove build/ and .dart_tool/build outputs.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'flutter_clean', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli('flutter');
        const result = await spawnCapture({
          cmd: cli,
          args: ['clean'],
          cwd: proj.root,
          timeoutMs: 30_000,
          signal: ctx.signal,
        });
        if (result.exitCode !== 0)
          return err(
            `flutter clean failed (exit ${result.exitCode}): ${tail(result.stderr, 2048)}`,
          );
        return okJson({ exitCode: 0, durationMs: result.durationMs });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<Record<string, never>>(server, {
    name: 'pub_cache_repair',
    description: 'Run `dart pub cache repair` to redownload all cached pub packages.',
    watchdog: { name: 'pub_cache_repair', ceilingMs: 2 * 60_000, toolClass: 'long' },
    handler: async (_args, ctx) => {
      try {
        const cli = resolveCli('dart');
        const result = await spawnCapture({
          cmd: cli,
          args: ['pub', 'cache', 'repair'],
          cwd: process.cwd(),
          timeoutMs: 2 * 60_000,
          signal: ctx.signal,
        });
        return okJson({
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdoutTail: tail(result.stdout, 16 * 1024),
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });
}

// ─── parsers ────────────────────────────────────────────────────────────────

interface Diagnostic {
  path: string;
  line: number;
  col: number;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  message: string;
}

function parseDartAnalyzeJson(stdout: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      // dart analyze --format json emits {version, diagnostics: [...]} typically as one final JSON object.
      const diags = (parsed['diagnostics'] as Array<Record<string, unknown>> | undefined) ?? [];
      for (const d of diags) {
        const location = (d['location'] as Record<string, unknown> | undefined) ?? {};
        const range = (location['range'] as Record<string, unknown> | undefined) ?? {};
        const start = (range['start'] as Record<string, unknown> | undefined) ?? {};
        out.push({
          path: String(location['file'] ?? ''),
          line: Number(start['line'] ?? 0),
          col: Number(start['column'] ?? 0),
          severity: String(d['severity'] ?? 'INFO').toUpperCase() as Diagnostic['severity'],
          code: String(d['code'] ?? ''),
          message: String((d['problemMessage'] as string | undefined) ?? d['message'] ?? ''),
        });
      }
      if (out.length > 0) return out;
      // fall through to try other JSON shapes
    } catch {
      // not JSON — skip
    }
  }
  return out;
}

function parseFormatSummary(
  stdout: string,
): { totalSeen: number; changed: number; durationMs?: number } | undefined {
  const m = stdout.match(/Formatted\s+(\d+)\s+file/);
  const c = stdout.match(/\((\d+)\s+changed\)/);
  if (!m) return undefined;
  return {
    totalSeen: Number(m[1] ?? 0),
    changed: Number(c?.[1] ?? 0),
  };
}

function parseFormatChangedFiles(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^Changed\s+(.+)$/);
    if (m && m[1]) out.push(m[1].trim());
  }
  return out;
}

interface DoctorSection {
  name: string;
  status: 'ok' | 'warning' | 'issue';
  raw: string;
}

function parseDoctorSections(stdout: string): DoctorSection[] {
  const sections: DoctorSection[] = [];
  const lines = stdout.split(/\r?\n/);
  let current: DoctorSection | undefined;
  for (const line of lines) {
    const m = line.match(/^\[(.)\]\s+(.+)$/);
    if (m) {
      if (current) sections.push(current);
      const symbol = m[1];
      const name = (m[2] ?? '').trim();
      const status: DoctorSection['status'] =
        symbol === '✓' ? 'ok' : symbol === '!' ? 'warning' : 'issue';
      current = { name, status, raw: line };
    } else if (current) {
      current.raw += '\n' + line;
    }
  }
  if (current) sections.push(current);
  return sections;
}

function tail(s: string, max: number): string {
  if (s.length <= max) return s;
  return '…\n' + s.slice(s.length - max);
}
