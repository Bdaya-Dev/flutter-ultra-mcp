// Linux distribution detection for install-instruction hints.
//
// AT-SPI requires distro-specific package installs:
//   * Debian / Ubuntu : apt install python3-gi gir1.2-atspi-2.0 at-spi2-core
//   * Fedora / RHEL   : dnf install python3-gobject atspi
//   * Arch / Manjaro  : pacman -S python-gobject at-spi2-core
//   * openSUSE        : zypper install python3-gobject typelib-1_0-Atspi-2_0
//   * Alpine          : apk add py3-gobject3 at-spi2-core
//
// We parse /etc/os-release (systemd-spec, supported by every modern distro
// including WSL distros) and return both a machine ID and a human-readable
// install command. When unparseable we return 'unknown' and a generic hint.

import { promises as fs } from 'node:fs';
import type { Device } from './device/types.js';

export type DistroId =
  | 'debian'
  | 'ubuntu'
  | 'fedora'
  | 'rhel'
  | 'centos'
  | 'rocky'
  | 'alma'
  | 'arch'
  | 'manjaro'
  | 'opensuse'
  | 'alpine'
  | 'unknown';

export interface DistroInfo {
  id: DistroId;
  prettyName: string;
  version: string | null;
  installCommand: string;
  source: 'os-release' | 'unknown';
}

const INSTALL_COMMANDS: Record<DistroId, string> = {
  debian: 'sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core',
  ubuntu: 'sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core',
  fedora: 'sudo dnf install -y python3-gobject atspi at-spi2-core',
  rhel: 'sudo dnf install -y python3-gobject at-spi2-core',
  centos: 'sudo dnf install -y python3-gobject at-spi2-core',
  rocky: 'sudo dnf install -y python3-gobject at-spi2-core',
  alma: 'sudo dnf install -y python3-gobject at-spi2-core',
  arch: 'sudo pacman -S --needed python-gobject at-spi2-core',
  manjaro: 'sudo pacman -S --needed python-gobject at-spi2-core',
  opensuse: 'sudo zypper install -y python3-gobject typelib-1_0-Atspi-2_0',
  alpine: 'sudo apk add py3-gobject3 at-spi2-core',
  unknown:
    'Install PyGObject + AT-SPI 2 typelib via your distro package manager. ' +
    'On Debian/Ubuntu: `apt install python3-gi gir1.2-atspi-2.0 at-spi2-core`.',
};

const ID_ALIASES: Record<string, DistroId> = {
  debian: 'debian',
  ubuntu: 'ubuntu',
  linuxmint: 'ubuntu',
  pop: 'ubuntu',
  fedora: 'fedora',
  rhel: 'rhel',
  centos: 'centos',
  rocky: 'rocky',
  almalinux: 'alma',
  arch: 'arch',
  manjaro: 'manjaro',
  endeavouros: 'arch',
  opensuse: 'opensuse',
  'opensuse-leap': 'opensuse',
  'opensuse-tumbleweed': 'opensuse',
  alpine: 'alpine',
};

interface OsRelease {
  ID?: string;
  ID_LIKE?: string;
  PRETTY_NAME?: string;
  VERSION_ID?: string;
}

function parseOsRelease(content: string): OsRelease {
  const result: OsRelease = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    let value = line.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === 'ID') result.ID = value;
    else if (key === 'ID_LIKE') result.ID_LIKE = value;
    else if (key === 'PRETTY_NAME') result.PRETTY_NAME = value;
    else if (key === 'VERSION_ID') result.VERSION_ID = value;
  }
  return result;
}

function classify(release: OsRelease): DistroId {
  const id = (release.ID ?? '').toLowerCase();
  if (id in ID_ALIASES) return ID_ALIASES[id] as DistroId;
  for (const candidate of (release.ID_LIKE ?? '').toLowerCase().split(/\s+/)) {
    if (candidate in ID_ALIASES) return ID_ALIASES[candidate] as DistroId;
  }
  return 'unknown';
}

/** Detect via direct host filesystem (LocalLinuxDevice fast path). */
export async function detectLocalDistro(): Promise<DistroInfo> {
  try {
    const raw = await fs.readFile('/etc/os-release', 'utf8');
    const release = parseOsRelease(raw);
    const id = classify(release);
    return {
      id,
      prettyName: release.PRETTY_NAME ?? id,
      version: release.VERSION_ID ?? null,
      installCommand: INSTALL_COMMANDS[id],
      source: 'os-release',
    };
  } catch {
    return {
      id: 'unknown',
      prettyName: 'unknown Linux',
      version: null,
      installCommand: INSTALL_COMMANDS.unknown,
      source: 'unknown',
    };
  }
}

/** Detect by `cat /etc/os-release` over a Device (works for WSL/SSH). */
export async function detectDeviceDistro(device: Device): Promise<DistroInfo> {
  const result = await device
    .exec('cat', ['/etc/os-release'], { timeoutMs: 5000 })
    .catch(() => null);
  if (!result || result.exitCode !== 0 || !result.stdout) {
    return {
      id: 'unknown',
      prettyName: 'unknown Linux (device probe failed)',
      version: null,
      installCommand: INSTALL_COMMANDS.unknown,
      source: 'unknown',
    };
  }
  const release = parseOsRelease(result.stdout);
  const id = classify(release);
  return {
    id,
    prettyName: release.PRETTY_NAME ?? id,
    version: release.VERSION_ID ?? null,
    installCommand: INSTALL_COMMANDS[id],
    source: 'os-release',
  };
}

export {
  INSTALL_COMMANDS as INSTALL_COMMANDS_FOR_TESTING,
  parseOsRelease as parseOsReleaseForTesting,
};
