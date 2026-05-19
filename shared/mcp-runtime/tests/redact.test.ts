import { describe, expect, it } from 'vitest';
import { redactVmServiceToken } from '../src/redact.js';

describe('redactVmServiceToken', () => {
  it('redacts a ws:// token segment', () => {
    expect(redactVmServiceToken('ws://127.0.0.1:12345/AbCdEf123=/ws')).toBe(
      'ws://127.0.0.1:12345/***/ws',
    );
  });

  it('redacts a wss:// token segment', () => {
    expect(redactVmServiceToken('wss://host:9999/token123/ws')).toBe(
      'wss://host:9999/***/ws',
    );
  });

  it('leaves non-VM URIs unchanged', () => {
    const url = 'http://127.0.0.1:5000/notoken';
    expect(redactVmServiceToken(url)).toBe(url);
  });

  it('redacts multiple URIs in one string', () => {
    const input =
      'first=ws://127.0.0.1:1111/TokenA=/ws second=wss://host:2222/TokenB/ws';
    expect(redactVmServiceToken(input)).toBe(
      'first=ws://127.0.0.1:1111/***/ws second=wss://host:2222/***/ws',
    );
  });

  it('returns empty string unchanged', () => {
    expect(redactVmServiceToken('')).toBe('');
  });
});
