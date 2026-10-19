// Pure matching logic for scripts/audit-gate.mjs, split out so
// scripts/audit-gate.test.mjs can specify its behavior without shelling
// out to `npm audit` or touching the filesystem.

export const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
export const GATE_THRESHOLD = SEVERITY_RANK.high; // mirrors --audit-level=high

/**
 * Walk `npm audit --json` output and return every REAL advisory it
 * contains. A `via` entry that is an OBJECT (has `.url`) is npm's own
 * GitHub Security Advisory record; a `via` entry that is a bare STRING
 * just names another already-enumerated vulnerable package (a pointer,
 * not a new advisory) and is skipped — structural, not text matching.
 */
export function collectAdvisories(auditJson) {
  const advisories = new Map(); // advisoryUrl -> {url, title, severity, packages:Set}
  for (const [pkgName, vuln] of Object.entries(auditJson.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !via.url) continue;
      const existing = advisories.get(via.url) ?? {
        url: via.url,
        title: via.title,
        severity: via.severity,
        packages: new Set(),
      };
      existing.packages.add(pkgName);
      if (via.dependency) existing.packages.add(via.dependency);
      advisories.set(via.url, existing);
    }
  }
  return [...advisories.values()];
}

/** https://github.com/advisories/GHSA-xxxx-xxxx-xxxx -> GHSA-xxxx-xxxx-xxxx */
export function ghsaId(advisoryUrl) {
  return advisoryUrl.split('/').pop();
}

/**
 * Split advisories (severity >= high) into `blocking` and `exempted`
 * against a Map of id -> exception ({ expired: boolean, ... }), as
 * already resolved by the caller (loadExceptions in audit-gate.mjs).
 * Below-threshold advisories are dropped entirely, same as plain
 * `npm audit --audit-level=high`.
 */
export function evaluate(advisories, exceptions) {
  const blocking = [];
  const exempted = [];
  for (const advisory of advisories) {
    if ((SEVERITY_RANK[advisory.severity] ?? 0) < GATE_THRESHOLD) continue;
    const id = ghsaId(advisory.url);
    const exception = exceptions.get(id);
    if (exception && !exception.expired) {
      exempted.push({ ...advisory, id, exception });
    } else {
      blocking.push({ ...advisory, id, expired: exception?.expired ?? false });
    }
  }
  return { blocking, exempted };
}
