import { describe, expect, it } from 'vitest';
import { parseAdbDevices } from './android.js';

describe('parseAdbDevices', () => {
  it('returns an empty array on empty input', () => {
    expect(parseAdbDevices('')).toEqual([]);
  });

  it('skips the "List of devices attached" header', () => {
    const text = `List of devices attached\nemulator-5554\tdevice product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1\n`;
    const out = parseAdbDevices(text);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      udid: 'emulator-5554',
      state: 'device',
      product: 'sdk_gphone64_x86_64',
      model: 'sdk_gphone64_x86_64',
      device: 'emu64xa',
      transportId: '1',
    });
  });

  it('parses multiple devices including offline', () => {
    const text = [
      'List of devices attached',
      'emulator-5554        device product:sdk model:Pixel device:emu transport_id:1',
      'PHYSICAL_UDID_HERE   unauthorized transport_id:2',
      'OFFLINE              offline transport_id:3',
      '',
    ].join('\n');
    const out = parseAdbDevices(text);
    expect(out).toHaveLength(3);
    expect(out.map((d) => d.state)).toEqual(['device', 'unauthorized', 'offline']);
  });

  it('ignores daemon notice lines starting with "*"', () => {
    const text = [
      '* daemon not running; starting now at tcp:5037',
      '* daemon started successfully',
      'List of devices attached',
      'emulator-5554\tdevice',
    ].join('\n');
    const out = parseAdbDevices(text);
    expect(out).toHaveLength(1);
    expect(out[0]?.udid).toBe('emulator-5554');
  });

  it('parses without -l metadata (minimal `adb devices` output)', () => {
    const text = 'List of devices attached\nemulator-5554\tdevice\n';
    const out = parseAdbDevices(text);
    expect(out).toEqual([{ udid: 'emulator-5554', state: 'device' }]);
  });
});
