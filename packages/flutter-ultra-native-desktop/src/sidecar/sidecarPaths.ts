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

/** Resolve the Linux helper path. Owned by worker-K but referenced here for unified registry. */
export function resolveLinuxHelperPath(): string {
  const fromEnv = process.env.FLUTTER_ULTRA_LINUX_HELPER;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return resolve(PACKAGE_SIDECARS, 'linux-atspi', 'at-spi-bridge.py');
}
