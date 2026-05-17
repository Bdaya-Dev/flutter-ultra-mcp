/**
 * Pubspec & dependency tools (plan §5.1 — Pubspec & dependencies):
 *
 *   pub_get, pub_add, pub_upgrade, pub_upgrade_major (split-tool MARATHON),
 *   pub_outdated, pub_deps, pub_dev_search
 *
 * pub_add atomically: edit pubspec.yaml → run pub get → rollback on failure.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err, errFromException } from '../runtime/result.js';
import { spawnCapture } from '../runtime/spawn.js';
import { resolveCli } from '../util/cli.js';
import { loadProject } from '../util/project.js';
import {
  cancelJob,
  readJob,
  readStdoutTail,
  startJob,
  type JobProgress,
  type ProgressParser,
} from '../runtime/jobs.js';

const rootArg = z
  .string()
  .min(1)
  .describe('Absolute path to a Flutter/Dart project root or descendant.');

class PubProgressParser implements ProgressParser {
  parse(line: string): JobProgress | undefined {
    if (/^Resolving dependencies/i.test(line)) return { stage: 'resolving' };
    if (/^Downloading /i.test(line)) return { stage: 'downloading', message: line.trim() };
    if (/^Got dependencies/i.test(line)) return { stage: 'complete', fraction: 1 };
    if (/^Changed /i.test(line)) return { message: line.trim() };
    return undefined;
  }
}

export function register(server: McpServer): void {
  defineTool<{ root: string; offline?: boolean }>(server, {
    name: 'pub_get',
    description:
      'Run `flutter pub get` (or `dart pub get` for non-Flutter projects). Returns stdout + structured stage progress.',
    inputSchema: {
      root: rootArg,
      offline: z
        .boolean()
        .optional()
        .default(false)
        .describe('Pass --offline; uses only cached packages.'),
    },
    watchdog: { name: 'pub_get', ceilingMs: 5 * 60_000, toolClass: 'long' },
    handler: async ({ root, offline }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
        const args = proj.isFlutter ? ['pub', 'get'] : ['pub', 'get'];
        if (offline) args.push('--offline');
        const parser = new PubProgressParser();
        const stages: string[] = [];
        const result = await spawnCapture({
          cmd: cli,
          args,
          cwd: proj.root,
          timeoutMs: 5 * 60_000,
          signal: ctx.signal,
          onStdoutLine: (line) => {
            const upd = parser.parse(line);
            if (upd?.stage && !stages.includes(upd.stage)) {
              stages.push(upd.stage);
              ctx.sendProgress({ progress: stages.length, message: upd.stage });
            }
          },
        });
        if (result.exitCode !== 0) {
          return err(
            `pub get failed (exit ${result.exitCode}). stderr: ${result.stderr.slice(-2048)}`,
            'Check pubspec.yaml syntax; run `pub_deps` to inspect the resolution graph.',
          );
        }
        return okJson({
          exitCode: 0,
          durationMs: result.durationMs,
          stages,
          stdout: result.stdout,
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{
    root: string;
    package: string;
    dev?: boolean;
    version?: string;
    runGet?: boolean;
  }>(server, {
    name: 'pub_add',
    description:
      'Add a dependency to pubspec.yaml then run pub get. Atomic: rolls back the pubspec edit if pub get fails.',
    inputSchema: {
      root: rootArg,
      package: z
        .string()
        .min(1)
        .describe('Package name on pub.dev (or local/git as supported by `dart pub add`).'),
      dev: z.boolean().optional().default(false).describe('Add as dev_dependency.'),
      version: z
        .string()
        .optional()
        .describe(
          'Optional version constraint, e.g. "^2.5.0". Defaults to caret-pin of latest stable.',
        ),
      runGet: z
        .boolean()
        .optional()
        .default(true)
        .describe('Run pub get after editing pubspec. Default true.'),
    },
    watchdog: { name: 'pub_add', ceilingMs: 5 * 60_000, toolClass: 'long' },
    handler: async ({ root, package: pkgName, dev, version, runGet }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
        const before = readFileSync(proj.pubspecPath, 'utf8');
        const spec = version ? `${pkgName}:${version}` : pkgName;
        const args = ['pub', 'add', ...(dev ? ['--dev'] : []), spec];
        if (!runGet) args.push('--no-install');
        const result = await spawnCapture({
          cmd: cli,
          args,
          cwd: proj.root,
          timeoutMs: 5 * 60_000,
          signal: ctx.signal,
        });
        if (result.exitCode !== 0) {
          // Roll back the pubspec edit so the user sees a clean state.
          writeFileSync(proj.pubspecPath, before, 'utf8');
          return err(
            `pub add ${spec} failed (exit ${result.exitCode}). Pubspec rolled back.\n` +
              `stderr: ${result.stderr.slice(-2048)}`,
            'Confirm the package exists on pub.dev and that the version constraint is satisfiable.',
          );
        }
        return okJson({
          exitCode: 0,
          durationMs: result.durationMs,
          added: { package: pkgName, dev: !!dev, version: version ?? null },
          stdoutTail: result.stdout.slice(-4096),
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string; package: string }>(server, {
    name: 'pub_remove',
    description: 'Remove a dependency from pubspec.yaml then run pub get.',
    inputSchema: {
      root: rootArg,
      package: z.string().min(1),
    },
    watchdog: { name: 'pub_remove', ceilingMs: 5 * 60_000, toolClass: 'long' },
    handler: async ({ root, package: pkgName }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
        const before = readFileSync(proj.pubspecPath, 'utf8');
        const result = await spawnCapture({
          cmd: cli,
          args: ['pub', 'remove', pkgName],
          cwd: proj.root,
          timeoutMs: 5 * 60_000,
          signal: ctx.signal,
        });
        if (result.exitCode !== 0) {
          writeFileSync(proj.pubspecPath, before, 'utf8');
          return err(
            `pub remove ${pkgName} failed (exit ${result.exitCode}). Pubspec rolled back.`,
          );
        }
        return okJson({ exitCode: 0, durationMs: result.durationMs, removed: pkgName });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'pub_upgrade',
    description: 'Run `pub upgrade` to bump constrained dependencies to latest within constraints.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'pub_upgrade', ceilingMs: 5 * 60_000, toolClass: 'long' },
    handler: async ({ root }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
        const result = await spawnCapture({
          cmd: cli,
          args: ['pub', 'upgrade'],
          cwd: proj.root,
          timeoutMs: 5 * 60_000,
          signal: ctx.signal,
        });
        if (result.exitCode !== 0) return err(`pub upgrade failed: ${result.stderr.slice(-2048)}`);
        return okJson({ exitCode: 0, durationMs: result.durationMs, stdout: result.stdout });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  // ─── pub_upgrade_major (MARATHON split-tool) ──────────────────────────────

  defineTool<{ root: string }>(server, {
    name: 'start_pub_upgrade_major',
    description:
      'MARATHON split-tool — start `pub upgrade --major-versions` as a background job. Returns {jobId}. Use poll_pub_upgrade_major / get_pub_upgrade_major_result / cancel_pub_upgrade_major.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'start_pub_upgrade_major', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root }) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
        const started = startJob({
          jobType: 'pub_upgrade_major',
          cmd: cli,
          args: ['pub', 'upgrade', '--major-versions'],
          cwd: proj.root,
          progressParser: new PubProgressParser(),
        });
        return okJson({ jobId: started.jobId, status: started.record.status });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ jobId: string }>(server, {
    name: 'poll_pub_upgrade_major',
    description: 'Poll a pub_upgrade_major job. Returns {status, progress, stdoutTail}.',
    inputSchema: { jobId: z.string().min(1) },
    watchdog: { name: 'poll_pub_upgrade_major', ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId }) => {
      const rec = readJob(jobId);
      if (!rec)
        return err(
          `Unknown jobId '${jobId}'.`,
          'List active jobs by polling jobs you started in this session.',
        );
      return okJson({ ...rec, stdoutTail: readStdoutTail(jobId, 8 * 1024) });
    },
  });

  defineTool<{ jobId: string }>(server, {
    name: 'get_pub_upgrade_major_result',
    description:
      'Retrieve final result for a completed pub_upgrade_major job. Errors if still running.',
    inputSchema: { jobId: z.string().min(1) },
    watchdog: { name: 'get_pub_upgrade_major_result', ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId }) => {
      const rec = readJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      if (rec.status === 'running' || rec.status === 'pending') {
        return err(
          `Job '${jobId}' still ${rec.status}.`,
          'Call poll_pub_upgrade_major until status is completed/failed/cancelled.',
        );
      }
      return okJson({ ...rec, stdout: readStdoutTail(jobId, 64 * 1024) });
    },
  });

  defineTool<{ jobId: string }>(server, {
    name: 'cancel_pub_upgrade_major',
    description: 'Cancel an in-flight pub_upgrade_major job. Sends SIGTERM then SIGKILL after 2s.',
    inputSchema: { jobId: z.string().min(1) },
    watchdog: { name: 'cancel_pub_upgrade_major', ceilingMs: 10_000, toolClass: 'instant' },
    handler: async ({ jobId }) => {
      const rec = cancelJob(jobId);
      if (!rec) return err(`Unknown jobId '${jobId}'.`);
      return okJson({ status: rec.status });
    },
  });

  // ─── pub_outdated / pub_deps / pub_dev_search ─────────────────────────────

  defineTool<{ root: string; mode?: 'json' | 'compact' }>(server, {
    name: 'pub_outdated',
    description:
      'Run `pub outdated --json` and return structured JSON. Lists packages with newer versions available.',
    inputSchema: {
      root: rootArg,
      mode: z.enum(['json', 'compact']).optional().default('json'),
    },
    watchdog: { name: 'pub_outdated', ceilingMs: 60_000, toolClass: 'long' },
    handler: async ({ root, mode }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
        const args = ['pub', 'outdated', ...(mode === 'json' ? ['--json'] : [])];
        const result = await spawnCapture({
          cmd: cli,
          args,
          cwd: proj.root,
          timeoutMs: 60_000,
          signal: ctx.signal,
        });
        let parsed: unknown;
        if (mode === 'json') {
          try {
            parsed = JSON.parse(result.stdout);
          } catch {
            parsed = null;
          }
        }
        return okJson({
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          parsed,
          raw: mode === 'json' ? undefined : result.stdout,
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'pub_deps',
    description:
      'Run `flutter pub deps --json` and return the dependency graph as structured JSON.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'pub_deps', ceilingMs: 60_000, toolClass: 'long' },
    handler: async ({ root }, ctx) => {
      try {
        const proj = loadProject(root);
        const cli = resolveCli(proj.isFlutter ? 'flutter' : 'dart');
        const result = await spawnCapture({
          cmd: cli,
          args: ['pub', 'deps', '--json'],
          cwd: proj.root,
          timeoutMs: 60_000,
          signal: ctx.signal,
        });
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.stdout);
        } catch {
          parsed = null;
        }
        return okJson({ exitCode: result.exitCode, durationMs: result.durationMs, graph: parsed });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ query: string; limit?: number }>(server, {
    name: 'pub_dev_search',
    description:
      'Search pub.dev for a package query. Returns up to `limit` matches with name, latest, score, description.',
    inputSchema: {
      query: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(50).optional().default(20),
    },
    watchdog: { name: 'pub_dev_search', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ query, limit }, ctx) => {
      const limitVal = limit ?? 20;
      try {
        const url = `https://pub.dev/api/search?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          signal: ctx.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'flutter-ultra-build/0.0.0' },
        });
        if (!res.ok) return err(`pub.dev search failed: HTTP ${res.status}`);
        const payload = (await res.json()) as { packages?: Array<{ package: string }> };
        const names = (payload.packages ?? []).slice(0, limitVal).map((p) => p.package);
        // Fetch each package's metadata in parallel (capped).
        const details = await Promise.all(
          names.map(async (name) => {
            try {
              const r = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(name)}`, {
                signal: ctx.signal,
                headers: { Accept: 'application/json', 'User-Agent': 'flutter-ultra-build/0.0.0' },
              });
              if (!r.ok) return { name };
              const meta = (await r.json()) as {
                name?: string;
                latest?: { version?: string; pubspec?: { description?: string } };
              };
              return {
                name,
                latest: meta.latest?.version,
                description: meta.latest?.pubspec?.description,
              };
            } catch {
              return { name };
            }
          }),
        );
        return okJson({ query, total: details.length, results: details });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  // ─── pubspec_overrides_* ───────────────────────────────────────────────────

  defineTool<{
    root: string;
    package: string;
    target:
      | { kind: 'path'; path: string }
      | { kind: 'git'; url: string; ref?: string; subPath?: string }
      | { kind: 'version'; version: string };
  }>(server, {
    name: 'pubspec_overrides_set',
    description:
      'Add/replace a dependency_overrides entry in pubspec_overrides.yaml (preferred over pubspec.yaml). Target may be path/git/version.',
    inputSchema: {
      root: rootArg,
      package: z.string().min(1),
      target: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('path'), path: z.string().min(1) }),
        z.object({
          kind: z.literal('git'),
          url: z.string().min(1),
          ref: z.string().optional(),
          subPath: z.string().optional(),
        }),
        z.object({ kind: z.literal('version'), version: z.string().min(1) }),
      ]),
    },
    watchdog: { name: 'pubspec_overrides_set', ceilingMs: 15_000, toolClass: 'quick' },
    handler: async ({ root, package: pkgName, target }) => {
      try {
        const proj = loadProject(root);
        const overridesPath = `${proj.root}/pubspec_overrides.yaml`;
        // Read or create the overrides file.
        let raw: string;
        try {
          raw = readFileSync(overridesPath, 'utf8');
        } catch {
          raw = 'dependency_overrides:\n';
        }
        // Naive merge: if `<pkgName>:` exists, replace its block; else append.
        // For simplicity we re-serialize via the yaml package.
        const { parseDocument, isMap } = await import('yaml');
        const doc = parseDocument(raw);
        const overrides = doc.get('dependency_overrides');
        if (!overrides || !isMap(overrides)) {
          doc.set('dependency_overrides', { [pkgName]: targetToNode(target) });
        } else {
          (overrides as { set: (k: string, v: unknown) => void }).set(
            pkgName,
            targetToNode(target),
          );
        }
        writeFileSync(overridesPath, String(doc), 'utf8');
        return okJson({ overridesPath, package: pkgName, target });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string; package: string }>(server, {
    name: 'pubspec_overrides_remove',
    description: 'Remove a dependency_overrides entry from pubspec_overrides.yaml.',
    inputSchema: { root: rootArg, package: z.string().min(1) },
    watchdog: { name: 'pubspec_overrides_remove', ceilingMs: 15_000, toolClass: 'quick' },
    handler: async ({ root, package: pkgName }) => {
      try {
        const proj = loadProject(root);
        const overridesPath = `${proj.root}/pubspec_overrides.yaml`;
        let raw: string;
        try {
          raw = readFileSync(overridesPath, 'utf8');
        } catch {
          return okJson({
            removed: pkgName,
            note: 'pubspec_overrides.yaml does not exist; nothing to do.',
          });
        }
        const { parseDocument, isMap } = await import('yaml');
        const doc = parseDocument(raw);
        const overrides = doc.get('dependency_overrides');
        if (overrides && isMap(overrides)) {
          (overrides as { delete: (k: string) => void }).delete(pkgName);
        }
        writeFileSync(overridesPath, String(doc), 'utf8');
        return okJson({ removed: pkgName });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'pubspec_overrides_list',
    description: 'List entries in pubspec_overrides.yaml.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'pubspec_overrides_list', ceilingMs: 15_000, toolClass: 'quick' },
    handler: async ({ root }) => {
      try {
        const proj = loadProject(root);
        const overridesPath = `${proj.root}/pubspec_overrides.yaml`;
        let raw: string;
        try {
          raw = readFileSync(overridesPath, 'utf8');
        } catch {
          return okJson({ overrides: {} });
        }
        const { parse } = await import('yaml');
        const parsed = parse(raw) as { dependency_overrides?: Record<string, unknown> } | null;
        return okJson({ overridesPath, overrides: parsed?.dependency_overrides ?? {} });
      } catch (e) {
        return errFromException(e);
      }
    },
  });
}

function targetToNode(
  target:
    | { kind: 'path'; path: string }
    | { kind: 'git'; url: string; ref?: string; subPath?: string }
    | { kind: 'version'; version: string },
): unknown {
  if (target.kind === 'path') return { path: target.path };
  if (target.kind === 'version') return target.version;
  const git: Record<string, string> = { url: target.url };
  if (target.ref) git['ref'] = target.ref;
  if (target.subPath) git['path'] = target.subPath;
  return { git };
}
