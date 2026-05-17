import { describe, expect, it } from 'vitest';
import { parseSimctlDevices, type SimctlDevicesJson } from './ios.js';

describe('parseSimctlDevices', () => {
  it('returns [] for an empty devices map', () => {
    expect(parseSimctlDevices({ devices: {} })).toEqual([]);
  });

  it('flattens runtime → device array', () => {
    const json: SimctlDevicesJson = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-4': [
          { udid: 'UDID-A', name: 'iPhone 15', state: 'Booted', isAvailable: true },
          { udid: 'UDID-B', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true },
        ],
        'com.apple.CoreSimulator.SimRuntime.iOS-16-2': [
          { udid: 'UDID-C', name: 'iPhone 14', state: 'Shutdown', isAvailable: true },
        ],
      },
    };
    const out = parseSimctlDevices(json);
    expect(out).toHaveLength(3);
    expect(out[0]?.runtime).toBe('iOS-17-4');
    expect(out[2]?.runtime).toBe('iOS-16-2');
    expect(out[0]?.kind).toBe('sim');
  });

  it('filters out unavailable simulators', () => {
    const json: SimctlDevicesJson = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-15-0': [
          { udid: 'UDID-D', name: 'iPhone X', state: 'Shutdown', isAvailable: false },
          { udid: 'UDID-E', name: 'iPhone XS', state: 'Shutdown', isAvailable: true },
        ],
      },
    };
    const out = parseSimctlDevices(json);
    expect(out).toHaveLength(1);
    expect(out[0]?.udid).toBe('UDID-E');
  });

  it('treats missing isAvailable as available', () => {
    const json: SimctlDevicesJson = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
          { udid: 'UDID-F', name: 'iPad', state: 'Shutdown' },
        ],
      },
    };
    expect(parseSimctlDevices(json)).toHaveLength(1);
  });
});
