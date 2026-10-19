#!/usr/bin/env node
// Structured npm-audit gate with a tiny, EXPIRING exception list.
//
// Plain `npm audit --audit-level=high` has no built-in way to accept one
// specific advisory while still failing on every other high/critical
// finding — npm ships no allowlist config of its own. This script closes
// exactly that gap, and nothing more:
//
//   1. Run `npm audit --json` over the FULL dependency tree (production
//      AND dev — this never hides devDependencies).
//   2. Collect every real advisory structurally (see collectAdvisories in
//      audit-gate-lib.mjs — no text/regex matching is involved).
//   3. Re-implement the --audit-level=high threshold (severity >= high).
//   4. Subtract ONLY the advisory ids listed in audit-exceptions.json,
//      and ONLY while that entry's reviewBy date has not passed. An
//      unlisted OR expired advisory fails the gate exactly like plain
//      `npm audit --audit-level=high` would.
//
// The matching rules themselves are specified in scripts/audit-gate.test.mjs
// (run first by the CI step — see .github/workflows/ci.yml) so a change
// that weakens them fails loudly instead of silently.
//
// See audit-exceptions.json for the current exception(s), the evidence
// each one cites, and its review date.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectAdvisories, evaluate } from './audit-gate-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function loadExceptions() {
  const file = path.join(repoRoot, 'audit-exceptions.json');
  const { exceptions } = JSON.parse(readFileSync(file, 'utf8'));
  const today = new Date();
  const byId = new Map();
  for (const entry of exceptions) {
    // Dates compare at UTC end-of-day: an exception is honored through the
    // whole of its reviewBy day and expires the day after.
    const reviewBy = new Date(`${entry.reviewBy}T23:59:59Z`);
    byId.set(entry.id, { ...entry, expired: !(today <= reviewBy) });
  }
  return byId;
}

function runAudit() {
  try {
    // shell: true so this resolves npm.cmd on Windows the same way a plain
    // `npm audit` invocation would from a shell — execFileSync does not
    // consult PATHEXT on its own (fixed, hardcoded argv; no injection risk).
    const out = execFileSync('npm', ['audit', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: true,
    });
    return JSON.parse(out);
  } catch (err) {
    // npm audit exits non-zero whenever it finds ANY vulnerability — that
    // is expected; the JSON report is still on stdout in that case.
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

const auditJson = runAudit();
const advisories = collectAdvisories(auditJson);
const exceptions = loadExceptions();
const { blocking, exempted } = evaluate(advisories, exceptions);

if (exempted.length > 0) {
  console.log('Exempted advisories (expiring — see audit-exceptions.json):');
  for (const e of exempted) {
    console.log(`  - ${e.id} (${e.severity}) in [${[...e.packages].join(', ')}]: ${e.title}`);
    console.log(`    reason: ${e.exception.reason}`);
    console.log(`    reviewBy: ${e.exception.reviewBy}`);
  }
}

if (blocking.length > 0) {
  console.error('\nDependency audit FAILED — high/critical advisories with no active exception:');
  for (const b of blocking) {
    const why = b.expired
      ? 'exception EXPIRED — renew in audit-exceptions.json or fix upstream'
      : 'no exception on file';
    console.error(
      `  - ${b.id} (${b.severity}) in [${[...b.packages].join(', ')}]: ${b.title} (${why})`,
    );
  }
  console.error(
    `\n${blocking.length} blocking advisor${blocking.length === 1 ? 'y' : 'ies'}, ${exempted.length} exempted.`,
  );
  process.exit(1);
}

console.log(`\nDependency audit PASSED (${exempted.length} exempted, 0 blocking).`);
process.exit(0);
