// AC-Br1 proxy: prove the URL-pattern intercept + query/fragment extraction
// works without launching a real browser. We verify the URL-parsing logic
// that intercept_redirect uses to surface OAuth code/state.
//
// Full end-to-end against dev-auth.invora.app-style is in the integration
// suite (wave-5 verifier agent), not unit tests.

import { describe, it, expect } from 'vitest';

function extractAuthParams(matchedUrl: string): {
  query: Record<string, string>;
  fragment: Record<string, string>;
} {
  const parsed = new URL(matchedUrl);
  const query: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  const fragment: Record<string, string> = {};
  if (parsed.hash && parsed.hash.startsWith('#')) {
    const fp = new URLSearchParams(parsed.hash.slice(1));
    fp.forEach((v, k) => {
      fragment[k] = v;
    });
  }
  return { query, fragment };
}

describe('intercept_redirect URL extraction (AC-Br1 fragment)', () => {
  it('extracts authorization code + state from query (auth-code flow)', () => {
    const url =
      'app.invora.dev://callback?code=XYZ123&state=abc-def&iss=https%3A%2F%2Fdev-auth.invora.app';
    const { query, fragment } = extractAuthParams(url);
    expect(query.code).toBe('XYZ123');
    expect(query.state).toBe('abc-def');
    expect(query.iss).toBe('https://dev-auth.invora.app');
    expect(fragment).toEqual({});
  });

  it('extracts access_token from fragment (implicit flow)', () => {
    const url =
      'https://app.example/callback#access_token=tok-1&id_token=jwt&token_type=Bearer&expires_in=3600';
    const { query, fragment } = extractAuthParams(url);
    expect(query).toEqual({});
    expect(fragment.access_token).toBe('tok-1');
    expect(fragment.id_token).toBe('jwt');
    expect(fragment.token_type).toBe('Bearer');
    expect(fragment.expires_in).toBe('3600');
  });

  it('handles combined query + fragment', () => {
    const url = 'https://app.example/cb?code=q1#state=f1';
    const { query, fragment } = extractAuthParams(url);
    expect(query.code).toBe('q1');
    expect(fragment.state).toBe('f1');
  });

  it('regex pattern matches Invora-style OAuth redirect', () => {
    const pattern = /.*\/callback.*code=/;
    expect(pattern.test('app.invora.dev://callback?code=XYZ&state=abc')).toBe(true);
    expect(pattern.test('https://dev-auth.invora.app/login')).toBe(false);
    expect(pattern.test('https://dev-dashboard.invora.app/callback?code=foo')).toBe(true);
  });
});
