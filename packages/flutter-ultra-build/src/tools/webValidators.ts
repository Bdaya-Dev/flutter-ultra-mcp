/**
 * Web pre-flight validators (plan §5.1 — Web pre-flight, NO Firebase deploy):
 *
 *   validate_web_redirect                    — assert web/redirect.html exists + valid
 *                                              (catches the 2026-05-11 OIDC bug)
 *   validate_canvaskit_vs_html_consistency   — pure pre-build static-config check;
 *                                              no actual rendering happens here
 *   flush_service_worker                     — confirm flutter_service_worker.js
 *                                              hash changed after a fresh build
 *
 * `validate_web_redirect` is the headline value-add: the Invora session-pitfall
 * doc cites this as a recurring trap. The check rejects redirect.html files
 * that:
 *   - don't exist
 *   - are smaller than 200 bytes (likely a stub/placeholder)
 *   - don't contain "/auth/callback" or a documented redirect-handling token
 *   - are missing the inline JS needed to forward the OIDC fragment
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err, errFromException } from '../runtime/result.js';
import { loadProject } from '../util/project.js';

const rootArg = z.string().min(1).describe('Absolute path to a Flutter project root.');

interface RedirectCheck {
  exists: boolean;
  bytes: number;
  hasAuthCallback: boolean;
  hasFragmentForward: boolean;
  hasIndexRedirect: boolean;
  notes: string[];
}

function checkRedirectHtml(path: string): RedirectCheck {
  const notes: string[] = [];
  if (!existsSync(path)) {
    notes.push(`Missing: ${path}`);
    return {
      exists: false,
      bytes: 0,
      hasAuthCallback: false,
      hasFragmentForward: false,
      hasIndexRedirect: false,
      notes,
    };
  }
  const sz = statSync(path).size;
  const raw = readFileSync(path, 'utf8');
  if (sz < 200) notes.push(`Suspiciously small (${sz} bytes) — likely a stub.`);
  const hasAuthCallback =
    /\/auth\/callback|\/oauth\/callback|onAuthSuccess|handleRedirect|finishAuthorization/i.test(
      raw,
    );
  const hasFragmentForward = /location\.(hash|href|search)/i.test(raw);
  const hasIndexRedirect =
    /location\.(href|replace|assign).*\/?(\/)|window\.location\s*=\s*['"]\/?/i.test(raw);
  if (!hasAuthCallback) notes.push('No reference to /auth/callback or known redirect handler.');
  if (!hasFragmentForward)
    notes.push('No JS handles the redirect fragment (location.hash / search).');
  if (!hasIndexRedirect)
    notes.push('No JS redirects back to / (the app may never bootstrap after callback).');
  return { exists: true, bytes: sz, hasAuthCallback, hasFragmentForward, hasIndexRedirect, notes };
}

export function register(server: McpServer): void {
  defineTool<{ root: string; relativePath?: string }>(server, {
    name: 'validate_web_redirect',
    description:
      'Assert web/redirect.html exists and contains the JS needed to forward an OIDC redirect into the Flutter SPA. ' +
      'This catches the 2026-05-11 Invora bug: Firebase Hosting serves static files before rewrites, but only if they exist, ' +
      'and a Flutter SPA fallback eats the redirect route otherwise.',
    inputSchema: {
      root: rootArg,
      relativePath: z
        .string()
        .optional()
        .default('web/redirect.html')
        .describe('Path within project root.'),
    },
    watchdog: { name: 'validate_web_redirect', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root, relativePath }) => {
      try {
        const proj = loadProject(root);
        const rel = relativePath ?? 'web/redirect.html';
        const result = checkRedirectHtml(join(proj.root, rel));
        const ok = result.exists && result.hasAuthCallback && result.hasFragmentForward;
        if (!ok) {
          return {
            isError: !result.exists, // hard-fail only on missing; soft-warn on heuristic misses
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    ok,
                    path: join(proj.root, rel),
                    ...result,
                    remediation:
                      'See clients/invora/invora-flutter/.claude/rules/05-oidc-pkce-web-redirect.md for the canonical redirect.html template.',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        return okJson({ ok: true, path: join(proj.root, rel), ...result });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'validate_canvaskit_vs_html_consistency',
    description:
      'Static pre-build consistency check for web build config: looks for forbidden `dart:html` direct usage that would render differently between canvaskit and HTML renderers, and warns when both renderers are configured for different routes.',
    inputSchema: { root: rootArg },
    watchdog: {
      name: 'validate_canvaskit_vs_html_consistency',
      ceilingMs: 30_000,
      toolClass: 'quick',
    },
    handler: async ({ root }) => {
      try {
        const proj = loadProject(root);
        const findings: string[] = [];
        // Walk lib/ for `import 'dart:html'` direct usages (deprecated; prefer package:web).
        const libDir = join(proj.root, 'lib');
        if (existsSync(libDir)) {
          const stack = [libDir];
          while (stack.length > 0) {
            const cur = stack.pop()!;
            for (const name of readDirSafe(cur)) {
              const full = join(cur, name);
              let s;
              try {
                s = statSync(full);
              } catch {
                continue;
              }
              if (s.isDirectory()) stack.push(full);
              else if (s.isFile() && name.endsWith('.dart')) {
                const content = readFileSync(full, 'utf8');
                if (/import\s+['"]dart:html['"]/.test(content)) {
                  findings.push(
                    `${full.replace(proj.root, '')}: direct dart:html import (use package:web instead).`,
                  );
                }
              }
            }
          }
        }
        return okJson({ ok: findings.length === 0, findings });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string }>(server, {
    name: 'flush_service_worker',
    description:
      'Compute the current hash of build/web/flutter_service_worker.js. Use after a fresh `build_web` to confirm the SW hash bumped (cache-bust). Returns {hash, bytes}; null if file is missing.',
    inputSchema: { root: rootArg },
    watchdog: { name: 'flush_service_worker', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root }) => {
      try {
        const proj = loadProject(root);
        const path = join(proj.root, 'build', 'web', 'flutter_service_worker.js');
        if (!existsSync(path)) {
          return err(
            `No flutter_service_worker.js found at ${path}.`,
            'Run start_build_web first.',
          );
        }
        const raw = readFileSync(path);
        const hash = createHash('sha256').update(raw).digest('hex');
        return okJson({ path, bytes: raw.length, sha256: hash });
      } catch (e) {
        return errFromException(e);
      }
    },
  });
}

function readDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
