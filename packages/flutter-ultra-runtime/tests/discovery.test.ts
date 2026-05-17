import { describe, expect, it } from 'vitest';
import { httpToWs } from '../src/index.js';

describe('httpToWs', () => {
  it('converts http URI to ws + appends /ws', () => {
    expect(httpToWs('http://127.0.0.1:50639/VQKkdeOH2R8=/')).toBe(
      'ws://127.0.0.1:50639/VQKkdeOH2R8=/ws',
    );
  });

  it('converts https URI to wss', () => {
    expect(httpToWs('https://localhost:9000/abc')).toBe('wss://localhost:9000/abc/ws');
  });

  it('idempotent when /ws already present', () => {
    expect(httpToWs('http://127.0.0.1:50639/token=/ws')).toBe('ws://127.0.0.1:50639/token=/ws');
  });
});
