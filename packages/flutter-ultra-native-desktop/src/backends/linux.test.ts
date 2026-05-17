import { describe, expect, it } from 'vitest';
import {
  ATSPI_BUS_REMEDIATION,
  describeLinuxError,
  LINUX_ERR_AT_SPI_FAILURE,
  LINUX_ERR_DIALOG_TIMEOUT,
  LINUX_ERR_ELEMENT_NOT_FOUND,
  LINUX_ERR_INPUT_TOOL_MISSING,
  LINUX_ERR_PERMISSION_NOT_GRANTED,
  LINUX_ERR_SCREENSHOT_TOOL_MISSING,
  LINUX_ERR_UNSUPPORTED_QUERY,
  LINUX_ERR_WAYLAND_LIMITATION,
  LINUX_ERR_WINDOW_NOT_FOUND,
} from './linux.js';
import { JsonRpcError } from '../rpc/jsonRpcClient.js';

describe('describeLinuxError', () => {
  it('returns the structured remediation for PERMISSION_NOT_GRANTED when supplied', () => {
    const err = new JsonRpcError(LINUX_ERR_PERMISSION_NOT_GRANTED, 'no bus', {
      remediation: 'install at-spi2-core',
    });
    expect(describeLinuxError(err)).toBe('install at-spi2-core');
  });

  it('falls back to ATSPI_BUS_REMEDIATION for PERMISSION_NOT_GRANTED with no data', () => {
    const err = new JsonRpcError(LINUX_ERR_PERMISSION_NOT_GRANTED, 'no bus');
    expect(describeLinuxError(err)).toBe(ATSPI_BUS_REMEDIATION);
  });

  it('attaches a "call list_windows first" hint for WINDOW_NOT_FOUND', () => {
    const err = new JsonRpcError(LINUX_ERR_WINDOW_NOT_FOUND, 'window 0/0 missing');
    expect(describeLinuxError(err)).toContain('list_windows');
  });

  it('attaches a "verify the element" hint for ELEMENT_NOT_FOUND', () => {
    const err = new JsonRpcError(LINUX_ERR_ELEMENT_NOT_FOUND, 'el-99 missing');
    expect(describeLinuxError(err)).toMatch(/dump_window_tree|desktop_query/);
  });

  it('points at the right install command for SCREENSHOT_TOOL_MISSING', () => {
    const err = new JsonRpcError(LINUX_ERR_SCREENSHOT_TOOL_MISSING, 'grim not found');
    const msg = describeLinuxError(err);
    expect(msg).toContain('scrot');
    expect(msg).toContain('grim');
  });

  it('mentions xdotool and ydotool for INPUT_TOOL_MISSING', () => {
    const err = new JsonRpcError(LINUX_ERR_INPUT_TOOL_MISSING, 'no input tool');
    const msg = describeLinuxError(err);
    expect(msg).toContain('xdotool');
    expect(msg).toContain('ydotool');
  });

  it('lists the supported XPath subset for UNSUPPORTED_QUERY', () => {
    const err = new JsonRpcError(LINUX_ERR_UNSUPPORTED_QUERY, 'bad query');
    expect(describeLinuxError(err)).toContain('//role');
  });

  it('redirects Wayland Flutter users to ultra_flutter for WAYLAND_LIMITATION', () => {
    const err = new JsonRpcError(LINUX_ERR_WAYLAND_LIMITATION, 'wayland degraded');
    expect(describeLinuxError(err)).toContain('ultra_flutter');
  });

  it('includes the code suffix for unrecognised JsonRpcError codes', () => {
    const err = new JsonRpcError(-99_999, 'mystery');
    expect(describeLinuxError(err)).toContain('code=-99999');
  });

  it('attaches a focus hint for AT_SPI_FAILURE', () => {
    const err = new JsonRpcError(LINUX_ERR_AT_SPI_FAILURE, 'GLib boom');
    expect(describeLinuxError(err)).toMatch(/unresponsive|focus|detached/);
  });

  it('attaches a timeout hint for DIALOG_TIMEOUT', () => {
    const err = new JsonRpcError(LINUX_ERR_DIALOG_TIMEOUT, 'no dialog');
    expect(describeLinuxError(err)).toMatch(/timeout|list_windows/);
  });

  it('passes through plain Error messages', () => {
    expect(describeLinuxError(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error values', () => {
    expect(describeLinuxError(42)).toBe('42');
  });
});

describe('ATSPI_BUS_REMEDIATION', () => {
  it('lists all five major distro families', () => {
    const text = ATSPI_BUS_REMEDIATION;
    expect(text).toContain('apt-get install');
    expect(text).toContain('dnf install');
    expect(text).toContain('pacman');
    expect(text).toContain('zypper');
    expect(text).toContain('apk');
  });

  it('mentions the systemd user unit for headless Wayland compositors', () => {
    expect(ATSPI_BUS_REMEDIATION).toContain('systemctl --user');
  });
});
