// Specification tests for audit-gate.mjs's matching logic, independent of
// whatever the LIVE `npm audit --json` happens to report today. These run
// in CI ahead of the real gate (see .github/workflows/ci.yml) so a change
// to the matching rules that would let an unrelated advisory slip through
// fails loudly, instead of being discovered the next time something new
// shows up in the dependency tree.
//
// Run directly: node --test scripts/audit-gate.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAdvisories, ghsaId, evaluate, SEVERITY_RANK } from './audit-gate-lib.mjs';

test('ghsaId extracts the trailing GHSA id from the advisory url', () => {
  assert.equal(ghsaId('https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'), 'GHSA-vfj7-8cjw-p6xm');
});

test('collectAdvisories picks up a real (object) via entry', () => {
  const fixture = {
    vulnerabilities: {
      braces: {
        severity: 'high',
        via: [
          {
            source: 1,
            name: 'braces',
            dependency: 'braces',
            title: 'braces vulnerable to stack-exhaustion denial of service',
            url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
            severity: 'high',
          },
        ],
      },
    },
  };
  const advisories = collectAdvisories(fixture);
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].url, 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm');
  assert.deepEqual([...advisories[0].packages].sort(), ['braces']);
});

test('collectAdvisories does NOT create a phantom advisory from a string via pointer', () => {
  const fixture = {
    vulnerabilities: {
      micromatch: { severity: 'high', via: ['braces'] }, // pointer only, no .url
    },
  };
  assert.deepEqual(collectAdvisories(fixture), []);
});

test('collectAdvisories unions package names when the same advisory is reached through several packages', () => {
  const advisory = {
    source: 1,
    name: 'braces',
    dependency: 'braces',
    title: 't',
    url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
    severity: 'high',
  };
  const fixture = {
    vulnerabilities: {
      braces: { severity: 'high', via: [advisory] },
      micromatch: { severity: 'high', via: ['braces'] },
      'semantic-release': { severity: 'high', via: ['micromatch'] },
    },
  };
  const advisories = collectAdvisories(fixture);
  assert.equal(advisories.length, 1);
  assert.deepEqual([...advisories[0].packages].sort(), ['braces']);
});

test('evaluate exempts an advisory with a matching, non-expired exception', () => {
  const exceptions = new Map([
    ['GHSA-vfj7-8cjw-p6xm', { id: 'GHSA-vfj7-8cjw-p6xm', reviewBy: '2099-01-01', expired: false }],
  ]);
  const advisories = [
    {
      url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
      severity: 'high',
      title: 't',
      packages: new Set(['braces']),
    },
  ];
  const { blocking, exempted } = evaluate(advisories, exceptions);
  assert.equal(blocking.length, 0);
  assert.equal(exempted.length, 1);
});

test('evaluate BLOCKS an advisory whose exception has expired', () => {
  const exceptions = new Map([
    ['GHSA-vfj7-8cjw-p6xm', { id: 'GHSA-vfj7-8cjw-p6xm', reviewBy: '2020-01-01', expired: true }],
  ]);
  const advisories = [
    {
      url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
      severity: 'high',
      title: 't',
      packages: new Set(['braces']),
    },
  ];
  const { blocking, exempted } = evaluate(advisories, exceptions);
  assert.equal(blocking.length, 1);
  assert.equal(exempted.length, 0);
});

test('evaluate BLOCKS an unrelated high-severity advisory the exceptions file does not mention — the generalization the gate exists for', () => {
  const exceptions = new Map([
    ['GHSA-vfj7-8cjw-p6xm', { id: 'GHSA-vfj7-8cjw-p6xm', reviewBy: '2099-01-01', expired: false }],
  ]);
  const advisories = [
    {
      url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
      severity: 'high',
      title: 'braces',
      packages: new Set(['braces']),
    },
    {
      url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
      severity: 'critical',
      title: 'some future advisory',
      packages: new Set(['some-other-pkg']),
    },
  ];
  const { blocking, exempted } = evaluate(advisories, exceptions);
  assert.equal(exempted.length, 1);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].id, 'GHSA-aaaa-bbbb-cccc');
});

test('evaluate ignores moderate/low/info — same threshold as --audit-level=high', () => {
  const exceptions = new Map();
  const advisories = [
    {
      url: 'https://github.com/advisories/GHSA-moderate-only-xxxx',
      severity: 'moderate',
      title: 't',
      packages: new Set(['pkg']),
    },
  ];
  const { blocking, exempted } = evaluate(advisories, exceptions);
  assert.equal(blocking.length, 0);
  assert.equal(exempted.length, 0);
});

test('SEVERITY_RANK orders info < low < moderate < high < critical', () => {
  assert.ok(SEVERITY_RANK.info < SEVERITY_RANK.low);
  assert.ok(SEVERITY_RANK.low < SEVERITY_RANK.moderate);
  assert.ok(SEVERITY_RANK.moderate < SEVERITY_RANK.high);
  assert.ok(SEVERITY_RANK.high < SEVERITY_RANK.critical);
});
