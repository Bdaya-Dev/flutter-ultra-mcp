import { describe, expect, it } from 'vitest';
import { INSTALL_COMMANDS_FOR_TESTING, parseOsReleaseForTesting } from '../src/platform.js';

describe('parseOsRelease', () => {
  it('parses an Ubuntu 22.04 os-release file', () => {
    const sample = `NAME="Ubuntu"\nVERSION="22.04.3 LTS (Jammy Jellyfish)"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 22.04.3 LTS"\nVERSION_ID="22.04"\n`;
    const result = parseOsReleaseForTesting(sample);
    expect(result.ID).toBe('ubuntu');
    expect(result.ID_LIKE).toBe('debian');
    expect(result.PRETTY_NAME).toBe('Ubuntu 22.04.3 LTS');
    expect(result.VERSION_ID).toBe('22.04');
  });

  it('parses a Fedora 39 os-release file', () => {
    const sample = `NAME="Fedora Linux"\nVERSION="39 (Workstation Edition)"\nID=fedora\nVERSION_ID=39\nPRETTY_NAME="Fedora Linux 39 (Workstation Edition)"\n`;
    const result = parseOsReleaseForTesting(sample);
    expect(result.ID).toBe('fedora');
    expect(result.VERSION_ID).toBe('39');
  });

  it('handles unquoted values and comments', () => {
    const sample = `# distro info\nID=arch\nNAME=Arch\n`;
    const result = parseOsReleaseForTesting(sample);
    expect(result.ID).toBe('arch');
  });

  it('handles single-quoted values', () => {
    const sample = `ID='alpine'\nPRETTY_NAME='Alpine Linux v3.19'\n`;
    const result = parseOsReleaseForTesting(sample);
    expect(result.ID).toBe('alpine');
    expect(result.PRETTY_NAME).toBe('Alpine Linux v3.19');
  });
});

describe('INSTALL_COMMANDS', () => {
  it('uses apt for debian-family', () => {
    expect(INSTALL_COMMANDS_FOR_TESTING.debian).toContain('apt-get');
    expect(INSTALL_COMMANDS_FOR_TESTING.ubuntu).toContain('apt-get');
    expect(INSTALL_COMMANDS_FOR_TESTING.debian).toContain('python3-gi');
    expect(INSTALL_COMMANDS_FOR_TESTING.debian).toContain('gir1.2-atspi-2.0');
  });

  it('uses dnf for rhel-family', () => {
    expect(INSTALL_COMMANDS_FOR_TESTING.fedora).toContain('dnf');
    expect(INSTALL_COMMANDS_FOR_TESTING.rhel).toContain('dnf');
    expect(INSTALL_COMMANDS_FOR_TESTING.rocky).toContain('dnf');
  });

  it('uses pacman for arch-family', () => {
    expect(INSTALL_COMMANDS_FOR_TESTING.arch).toContain('pacman');
    expect(INSTALL_COMMANDS_FOR_TESTING.manjaro).toContain('pacman');
  });

  it('uses zypper for opensuse', () => {
    expect(INSTALL_COMMANDS_FOR_TESTING.opensuse).toContain('zypper');
  });

  it('uses apk for alpine', () => {
    expect(INSTALL_COMMANDS_FOR_TESTING.alpine).toContain('apk');
  });

  it('falls back to a generic hint when distro is unknown', () => {
    expect(INSTALL_COMMANDS_FOR_TESTING.unknown).toMatch(/apt|distro/i);
  });
});
