// Integration test for WindowsDesktopBackend.
//
// On Windows hosts where the FlaUI sidecar has been built, this spins up the real
// helper, exchanges `hello`, and round-trips `listWindows`. On non-Windows hosts
// or when the binary is missing, the tests skip rather than fail — keeping CI green
// across the matrix.

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

import { LocalDevice } from '../device/local.js';
import { WindowsDesktopBackend, describeWindowsError } from './windows.js';
import { resolveWinHelperPath } from '../sidecar/sidecarPaths.js';
import { JsonRpcError } from '../rpc/jsonRpcClient.js';

interface MinimalLogger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

const silentLogger: MinimalLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const helperPath = resolveWinHelperPath();
const isWindows = process.platform === 'win32';
const helperPresent = isWindows && existsSync(helperPath);
const runIntegration = isWindows && helperPresent;

describe('WindowsDesktopBackend', () => {
  it('describeWindowsError handles JsonRpcError + plain Error + unknown', () => {
    expect(describeWindowsError(new JsonRpcError(-32_001, 'Window not found'))).toMatch(/list_windows/);
    expect(describeWindowsError(new JsonRpcError(-32_002, 'no element'))).toMatch(/dump_window_tree/);
    expect(describeWindowsError(new JsonRpcError(-32_003, 'COM fail'))).toMatch(/UIA/);
    expect(describeWindowsError(new JsonRpcError(-32_004, 'timeout'))).toMatch(/timeout/i);
    expect(describeWindowsError(new JsonRpcError(-32_000, 'helper down', { remediation: 'rebuild' })))
      .toBe('rebuild');
    expect(describeWindowsError(new JsonRpcError(-32_010, 'unknown', undefined))).toMatch(/-32010/);
    expect(describeWindowsError(new Error('plain'))).toBe('plain');
    expect(describeWindowsError('string err')).toBe('string err');
  });

  it.runIf(isWindows && !helperPresent)(
    'returns null when helper binary is missing (AC-ND4)',
    async () => {
      const device = new LocalDevice();
      const backend = await WindowsDesktopBackend.create({
        device,
        // deliberately bogus path
        helperPath: 'C:\\does-not-exist\\flutter-ultra-win-helper.exe',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        logger: silentLogger as any,
      });
      expect(backend).toBeNull();
    },
    10_000,
  );

  it.runIf(runIntegration)(
    'spins up the real FlaUI sidecar, completes handshake, lists windows',
    async () => {
      const device = new LocalDevice();
      const backend = await WindowsDesktopBackend.create({
        device,
        helperPath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        logger: silentLogger as any,
      });
      expect(backend).not.toBeNull();
      if (!backend) return;

      try {
        expect(backend.capabilities.platform).toBe('win32');
        expect(backend.capabilities.helperPresent).toBe(true);
        expect(backend.capabilities.permissionGranted).toBe(true);

        const wins = await backend.listWindows({});
        expect(Array.isArray(wins)).toBe(true);
        // The CI worker is headless but the OS itself still has at least one shell window.
        // Assert shape on whatever it returns, even if empty.
        for (const w of wins) {
          expect(typeof w.id).toBe('string');
          expect(typeof w.title).toBe('string');
          expect(typeof w.pid).toBe('number');
          expect(typeof w.bounds.width).toBe('number');
        }
      } finally {
        await backend.shutdown();
      }
    },
    30_000,
  );
});
