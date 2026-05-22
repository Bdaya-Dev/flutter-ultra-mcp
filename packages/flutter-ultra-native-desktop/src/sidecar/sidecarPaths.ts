// Path resolution for bundled per-OS sidecars.
//
// During development the binaries live under sidecars/<os>/build/; in
// installed plugins they live at ${CLAUDE_PLUGIN_ROOT}/packages/
// flutter-ultra-native-desktop/sidecars/<os>/. The env vars exposed by
// .mcp.json (FLUTTER_ULTRA_MAC_HELPER, etc.) are the authoritative
// override — they win over the auto-detected paths so distribution can
// relocate binaries freely.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// src/sidecar/sidecarPaths.ts → ../../sidecars
const PACKAGE_SIDECARS = resolve(HERE, '..', '..', 'sidecars');

/** Resolve the macOS helper path, preferring the explicit env var. */
export function resolveMacHelperPath(): string {
  const fromEnv = process.env.FLUTTER_ULTRA_MAC_HELPER;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // SwiftPM builds to .build/release/flutter-ultra-mac-helper inside the
  // sidecars/macos-swift/ project; CI ALSO copies it to sidecars/macos-swift/bin/.
  return resolve(PACKAGE_SIDECARS, 'macos-swift', 'bin', 'flutter-ultra-mac-helper');
}

/** Resolve the Windows helper path. Owned by worker-I but referenced here for unified registry. */
export function resolveWinHelperPath(): string {
  const fromEnv = process.env.FLUTTER_ULTRA_WIN_HELPER;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return resolve(PACKAGE_SIDECARS, 'windows-flaui', 'bin', 'flutter-ultra-win-helper.exe');
}

/**
 * Resolve the Linux AT-SPI sidecar directory.
 *
 * Unlike the macOS/Windows binaries this points at the *directory* holding
 * the ``atspi_bridge/`` Python package — the Linux backend invokes
 * ``python3 -u -m atspi_bridge`` with this on PYTHONPATH so the package
 * boots correctly. Override via ``FLUTTER_ULTRA_LINUX_HELPER`` to point at
 * a custom location (e.g. a virtualenv-installed copy).
 */
export function resolveLinuxHelperPath(): string {
  const fromEnv = process.env.FLUTTER_ULTRA_LINUX_HELPER;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return resolve(PACKAGE_SIDECARS, 'linux-atspi');
}

/**
 * Resolve the Python interpreter for the Linux AT-SPI sidecar.
 *
 * Defaults to ``python3`` on PATH; override via ``FLUTTER_ULTRA_LINUX_PYTHON``
 * for distro-specific paths (e.g. ``/usr/bin/python3.12``) or for using a
 * virtualenv with ``vext``-installed PyGObject.
 */
export function resolveLinuxPythonBin(): string {
  const fromEnv = process.env.FLUTTER_ULTRA_LINUX_PYTHON;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return 'python3';
}

/**
 * SSH config for remote macOS testing. All fields are optional; when all are
 * absent, SshDevice creation is skipped and local backend selection runs.
 *
 * Env vars:
 *   FLUTTER_ULTRA_SSH_HOST       — remote hostname or IP (required to activate)
 *   FLUTTER_ULTRA_SSH_PORT       — SSH port (default 22)
 *   FLUTTER_ULTRA_SSH_USER       — SSH username (default "flutter")
 *   FLUTTER_ULTRA_SSH_KEY        — path to private key file (default ~/.ssh/id_rsa)
 *   FLUTTER_ULTRA_SSH_MAC_HELPER — path to the Swift helper on the REMOTE host
 */
export interface SshConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  remoteHelperPath: string;
}

export function resolveSshConfig(): SshConfig | null {
  const host = process.env.FLUTTER_ULTRA_SSH_HOST;
  if (!host || host.length === 0) return null;
  const port = parseInt(process.env.FLUTTER_ULTRA_SSH_PORT ?? '22', 10);
  const username = process.env.FLUTTER_ULTRA_SSH_USER ?? 'flutter';
  const privateKeyPath =
    process.env.FLUTTER_ULTRA_SSH_KEY ??
    `${process.env.HOME ?? process.env.USERPROFILE ?? '~'}/.ssh/id_rsa`;
  const remoteHelperPath =
    process.env.FLUTTER_ULTRA_SSH_MAC_HELPER ?? '/usr/local/bin/flutter-ultra-mac-helper';
  return { host, port, username, privateKeyPath, remoteHelperPath };
}
