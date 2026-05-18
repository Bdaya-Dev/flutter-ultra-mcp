import { describe, it, expect, beforeEach } from 'vitest';
import { DeviceRouter } from '../src/router.js';

describe('DeviceRouter', () => {
  let router: DeviceRouter;

  beforeEach(() => {
    router = new DeviceRouter();
  });

  it('always has local device', () => {
    const local = router.get('local');
    expect(local).toBeDefined();
    expect(local!.id).toBe('local');
    expect(local!.kind).toBe('local');
  });

  it('resolve defaults to local', () => {
    const device = router.resolve();
    expect(device.id).toBe('local');
  });

  it('resolve with explicit "local" returns local', () => {
    const device = router.resolve('local');
    expect(device.id).toBe('local');
  });

  it('resolve throws for unknown device', () => {
    expect(() => router.resolve('wsl:NonExistent')).toThrow(/not connected/i);
  });

  it('listAvailable includes local', async () => {
    const available = await router.listAvailable();
    expect(available.length).toBeGreaterThanOrEqual(1);
    expect(available[0]!.id).toBe('local');
    expect(available[0]!.kind).toBe('local');
  });

  it('disconnect throws for local', async () => {
    await expect(router.disconnect('local')).rejects.toThrow(/cannot disconnect local/i);
  });

  it('disconnect is safe for unknown device', async () => {
    await expect(router.disconnect('wsl:Unknown')).resolves.toBeUndefined();
  });

  it('connectedIds includes local', () => {
    const ids = router.connectedIds();
    expect(ids).toContain('local');
  });

  it('closeAll leaves local intact', async () => {
    await router.closeAll();
    expect(router.get('local')).toBeDefined();
    expect(router.connectedIds()).toEqual(['local']);
  });
});
