import { describe, expect, it } from 'vitest';
import { FinderSchema, matchesText, RectSchema } from '../src/index.js';

describe('FinderSchema', () => {
  it('parses key finder', () => {
    const f = FinderSchema.parse({ kind: 'key', value: 'login_button' });
    expect(f).toEqual({ kind: 'key', value: 'login_button' });
  });

  it('applies default matchType to text finder', () => {
    const f = FinderSchema.parse({ kind: 'text', value: 'Login' });
    if (f.kind !== 'text') throw new Error('expected text');
    expect(f.matchType).toBe('exact');
    expect(f.caseInsensitive).toBe(false);
  });

  it('parses coords', () => {
    const f = FinderSchema.parse({ kind: 'coords', x: 100, y: 200 });
    expect(f).toEqual({ kind: 'coords', x: 100, y: 200 });
  });

  it('rejects unknown kind', () => {
    expect(() => FinderSchema.parse({ kind: 'mystery', value: 'X' })).toThrow();
  });
});

describe('matchesText', () => {
  it('exact', () => {
    expect(matchesText('Login', { value: 'Login', matchType: 'exact' })).toBe(true);
    expect(matchesText('Logout', { value: 'Login', matchType: 'exact' })).toBe(false);
  });

  it('contains', () => {
    expect(matchesText('Please Login Now', { value: 'Login', matchType: 'contains' })).toBe(true);
  });

  it('regex', () => {
    expect(matchesText('user-42', { value: '^user-\\d+$', matchType: 'regex' })).toBe(true);
  });

  it('caseInsensitive', () => {
    expect(
      matchesText('LOGIN', { value: 'login', matchType: 'exact', caseInsensitive: true }),
    ).toBe(true);
  });

  it('invalid regex returns false', () => {
    expect(matchesText('abc', { value: '[', matchType: 'regex' })).toBe(false);
  });
});

describe('RectSchema', () => {
  it('parses rect', () => {
    expect(RectSchema.parse({ x: 0, y: 0, width: 100, height: 50 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });
});
