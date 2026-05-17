import { describe, expect, it } from 'vitest';
import { isLinux, isMacOS, isWindows } from '../../../src/util/platform.js';

describe('platform helpers', () => {
  it('classifies the three OS families via injected platform value', () => {
    expect(isWindows('win32')).toBe(true);
    expect(isMacOS('darwin')).toBe(true);
    expect(isLinux('linux')).toBe(true);
    expect(isWindows('linux')).toBe(false);
    expect(isMacOS('win32')).toBe(false);
    expect(isLinux('darwin')).toBe(false);
  });
});
