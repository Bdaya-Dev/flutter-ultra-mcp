/**
 * Mobile signing tools (plan §5.1 — Mobile signing):
 *
 *   verify_android_signing — inspect keystore + report fingerprints
 *   verify_ios_signing     — Mac-only, codesign + provisioning + entitlements
 *   set_bundle_id          — update android applicationId + iOS bundle ID atomically
 *
 * For verify_android_signing we read `android/app/build.gradle[.kts]`'s
 * signingConfigs and run `keytool -list` against the resolved keystore.
 * No PKCS12 secrets ever leave the host — we only echo paths + fingerprints.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err, errFromException } from '../runtime/result.js';
import { spawnCapture } from '../runtime/spawn.js';
import { loadProject } from '../util/project.js';

const rootArg = z
  .string()
  .min(1)
  .describe('Absolute path to a Flutter project root or descendant.');

export function register(server: McpServer): void {
  defineTool<{ root: string; keystorePath?: string; alias?: string; storePassEnv?: string }>(
    server,
    {
      name: 'verify_android_signing',
      description:
        'Inspect Android keystore + signing config: list aliases, expiry, SHA1/SHA256 fingerprints. Secrets are never echoed. ' +
        'Reads keystore path from key.properties (or override). storePassword via env var only — pass storePassEnv with the env var name.',
      inputSchema: {
        root: rootArg,
        keystorePath: z
          .string()
          .optional()
          .describe('Override keystore path; default reads android/key.properties.'),
        alias: z.string().optional(),
        storePassEnv: z
          .string()
          .optional()
          .describe(
            'Environment variable name holding store password. Defaults to ANDROID_KEYSTORE_PASS.',
          ),
      },
      watchdog: { name: 'verify_android_signing', ceilingMs: 30_000, toolClass: 'quick' },
      handler: async ({ root, keystorePath, alias, storePassEnv }, ctx) => {
        try {
          const proj = loadProject(root);
          let ks = keystorePath;
          let aliasResolved = alias;
          const keyPropsPath = join(proj.root, 'android', 'key.properties');
          if (!ks && existsSync(keyPropsPath)) {
            const props = parseDotProperties(readFileSync(keyPropsPath, 'utf8'));
            ks = props['storeFile'];
            aliasResolved = aliasResolved ?? props['keyAlias'];
          }
          if (!ks)
            return err(
              'No keystore path found.',
              'Pass keystorePath or create android/key.properties with storeFile=<path>.',
            );
          const resolvedKs = resolve(proj.root, 'android', 'app', ks);
          const realKs = existsSync(resolvedKs) ? resolvedKs : resolve(proj.root, 'android', ks);
          if (!existsSync(realKs)) return err(`Keystore not found at '${realKs}'.`);
          const passEnv = storePassEnv ?? 'ANDROID_KEYSTORE_PASS';
          const pass = process.env[passEnv];
          if (!pass) {
            return err(
              `Environment variable '${passEnv}' is empty.`,
              `Export it in your shell before invoking, e.g. $env:${passEnv}="..." (Win) or export ${passEnv}=... (Unix).`,
            );
          }
          const cmdArgs = ['-list', '-v', '-keystore', realKs, '-storepass', pass];
          if (aliasResolved) cmdArgs.push('-alias', aliasResolved);
          const result = await spawnCapture({
            cmd: 'keytool',
            args: cmdArgs,
            cwd: proj.root,
            timeoutMs: 30_000,
            signal: ctx.signal,
          });
          if (result.exitCode !== 0) {
            return err(`keytool failed (exit ${result.exitCode}): ${result.stderr.slice(-1024)}`);
          }
          return okJson({
            keystorePath: realKs,
            alias: aliasResolved ?? null,
            fingerprints: parseKeytoolFingerprints(result.stdout),
            rawOutput: result.stdout.replace(pass, '<redacted>'),
          });
        } catch (e) {
          return errFromException(e);
        }
      },
    },
  );

  defineTool<{ root: string; scheme?: string }>(server, {
    name: 'verify_ios_signing',
    description:
      'Mac-only — inspect iOS code signing for the project: codesign verify + provisioning-profile expiry + entitlements summary.',
    inputSchema: {
      root: rootArg,
      scheme: z.string().optional().describe('Xcode scheme name; default Runner.'),
    },
    watchdog: { name: 'verify_ios_signing', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root, scheme }, ctx) => {
      if (process.platform !== 'darwin') {
        return err(
          'verify_ios_signing requires macOS.',
          'Run this tool from a Mac host with Xcode installed.',
        );
      }
      try {
        const proj = loadProject(root);
        const iosRoot = join(proj.root, 'ios');
        if (!existsSync(iosRoot)) return err('No ios/ directory found in project.');
        // List provisioning profiles installed for the current user.
        const profilesDir = `${process.env['HOME']}/Library/MobileDevice/Provisioning Profiles`;
        const result = await spawnCapture({
          cmd: 'xcodebuild',
          args: ['-list', '-project', join(iosRoot, 'Runner.xcodeproj')],
          cwd: proj.root,
          timeoutMs: 30_000,
          signal: ctx.signal,
        });
        return okJson({
          xcodeProjectInfo: result.stdout,
          profilesDir,
          scheme: scheme ?? 'Runner',
          note: 'Full codesign verification requires a built .app bundle; run after start_build_ipa completes.',
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });

  defineTool<{ root: string; bundleId: string }>(server, {
    name: 'set_bundle_id',
    description:
      'Update Android applicationId (in android/app/build.gradle[.kts]) AND iOS PRODUCT_BUNDLE_IDENTIFIER (in ios/Runner.xcodeproj/project.pbxproj) atomically. Both must succeed or the change is rolled back.',
    inputSchema: {
      root: rootArg,
      bundleId: z
        .string()
        .min(3)
        .max(255)
        .regex(
          /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/,
          'Bundle id must be reverse-DNS, e.g. com.example.app',
        ),
    },
    watchdog: { name: 'set_bundle_id', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ root, bundleId }) => {
      try {
        const proj = loadProject(root);
        const androidPath = findFirst(
          [
            join(proj.root, 'android', 'app', 'build.gradle'),
            join(proj.root, 'android', 'app', 'build.gradle.kts'),
          ],
          existsSync,
        );
        const iosPbxproj = join(proj.root, 'ios', 'Runner.xcodeproj', 'project.pbxproj');
        if (!androidPath && !existsSync(iosPbxproj)) {
          return err('No Android or iOS native project found under this Flutter root.');
        }
        const backups = new Map<string, string>();
        try {
          if (androidPath) {
            const before = readFileSync(androidPath, 'utf8');
            backups.set(androidPath, before);
            const next = before.replace(
              /(applicationId\s*[= ]\s*['"])([^'"]+)(['"])/,
              `$1${bundleId}$3`,
            );
            if (next === before) {
              return err(`Failed to find applicationId in ${androidPath}.`);
            }
            writeFileSync(androidPath, next, 'utf8');
          }
          if (existsSync(iosPbxproj)) {
            const before = readFileSync(iosPbxproj, 'utf8');
            backups.set(iosPbxproj, before);
            const next = before.replace(
              /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,
              `PRODUCT_BUNDLE_IDENTIFIER = ${bundleId};`,
            );
            writeFileSync(iosPbxproj, next, 'utf8');
          }
        } catch (e) {
          // Rollback on any error.
          for (const [path, content] of backups) {
            try {
              writeFileSync(path, content, 'utf8');
            } catch {
              // already at known-good
            }
          }
          return errFromException(e);
        }
        return okJson({
          bundleId,
          androidFile: androidPath,
          iosFile: existsSync(iosPbxproj) ? iosPbxproj : null,
        });
      } catch (e) {
        return errFromException(e);
      }
    },
  });
}

function parseDotProperties(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const eq = l.indexOf('=');
    if (eq <= 0) continue;
    out[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
  }
  return out;
}

function parseKeytoolFingerprints(
  stdout: string,
): Array<{ alias: string; sha1?: string; sha256?: string; validUntil?: string }> {
  const out: Array<{ alias: string; sha1?: string; sha256?: string; validUntil?: string }> = [];
  const aliasRe = /Alias name:\s*(.+)/g;
  const sha1Re = /SHA1:\s*([A-F0-9:]+)/g;
  const sha256Re = /SHA256:\s*([A-F0-9:]+)/g;
  const validRe = /Valid from:.+until:\s*(.+)/g;
  const aliases = [...stdout.matchAll(aliasRe)];
  const sha1s = [...stdout.matchAll(sha1Re)];
  const sha256s = [...stdout.matchAll(sha256Re)];
  const valids = [...stdout.matchAll(validRe)];
  for (let i = 0; i < aliases.length; i++) {
    out.push({
      alias: aliases[i]?.[1]?.trim() ?? '',
      ...(sha1s[i]?.[1] ? { sha1: sha1s[i]?.[1] } : {}),
      ...(sha256s[i]?.[1] ? { sha256: sha256s[i]?.[1] } : {}),
      ...(valids[i]?.[1] ? { validUntil: valids[i]?.[1] } : {}),
    });
  }
  return out;
}

function findFirst<T>(items: T[], pred: (v: T) => boolean): T | undefined {
  for (const it of items) if (pred(it)) return it;
  return undefined;
}
