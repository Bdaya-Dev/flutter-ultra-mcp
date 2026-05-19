import { describe, expect, it } from 'vitest';
import { parseDartDefinesFromArgs } from '../src/launchApp.js';

describe('parseDartDefinesFromArgs', () => {
  it('parses single-element --dart-define=key=value', () => {
    const out = parseDartDefinesFromArgs(['--dart-define=oidc-client-id-web=12345']);
    expect(out).toEqual({ 'oidc-client-id-web': '12345' });
  });

  it('parses single-element --dart-defines=key=value', () => {
    const out = parseDartDefinesFromArgs(['--dart-defines=api-url=https://example.com']);
    expect(out).toEqual({ 'api-url': 'https://example.com' });
  });

  it('parses two-element --dart-define key=value', () => {
    const out = parseDartDefinesFromArgs(['--dart-define', 'oidc-client-id-web=12345']);
    expect(out).toEqual({ 'oidc-client-id-web': '12345' });
  });

  it('parses two-element --dart-defines key=value', () => {
    const out = parseDartDefinesFromArgs(['--dart-defines', 'grpc-url=test.api.com']);
    expect(out).toEqual({ 'grpc-url': 'test.api.com' });
  });

  it('handles mixed single-element and two-element forms', () => {
    const out = parseDartDefinesFromArgs([
      '--dart-define=A=1',
      '--dart-define',
      'B=2',
      '--dart-defines=C=3',
      '--dart-defines',
      'D=4',
    ]);
    expect(out).toEqual({ A: '1', B: '2', C: '3', D: '4' });
  });

  it('handles values containing = signs', () => {
    const out = parseDartDefinesFromArgs(['--dart-define=url=https://a.com?q=1&r=2']);
    expect(out).toEqual({ url: 'https://a.com?q=1&r=2' });
  });

  it('handles two-element form with values containing = signs', () => {
    const out = parseDartDefinesFromArgs(['--dart-define', 'url=https://a.com?q=1']);
    expect(out).toEqual({ url: 'https://a.com?q=1' });
  });

  it('handles empty value', () => {
    const out = parseDartDefinesFromArgs(['--dart-define=key=']);
    expect(out).toEqual({ key: '' });
  });

  it('handles empty value in two-element form', () => {
    const out = parseDartDefinesFromArgs(['--dart-define', 'key=']);
    expect(out).toEqual({ key: '' });
  });

  it('ignores non-dart-define flags', () => {
    const out = parseDartDefinesFromArgs([
      '--flavor',
      'dev',
      '--dart-define=A=1',
      '--verbose',
      '--dart-define',
      'B=2',
      '-t',
      'lib/main.dart',
    ]);
    expect(out).toEqual({ A: '1', B: '2' });
  });

  it('ignores bare --dart-define at end of array (no value follows)', () => {
    const out = parseDartDefinesFromArgs(['--dart-define=A=1', '--dart-define']);
    expect(out).toEqual({ A: '1' });
  });

  it('ignores --dart-define followed by another flag (not key=value)', () => {
    const out = parseDartDefinesFromArgs(['--dart-define', '--verbose', '--dart-define=A=1']);
    expect(out).toEqual({ A: '1' });
  });

  it('later defines override earlier ones', () => {
    const out = parseDartDefinesFromArgs([
      '--dart-define=key=first',
      '--dart-define',
      'key=second',
    ]);
    expect(out).toEqual({ key: 'second' });
  });

  it('populates an existing output record', () => {
    const existing: Record<string, string> = { pre: 'existing' };
    parseDartDefinesFromArgs(['--dart-define=new=val'], existing);
    expect(existing).toEqual({ pre: 'existing', new: 'val' });
  });

  it('returns empty record for empty args', () => {
    expect(parseDartDefinesFromArgs([])).toEqual({});
  });

  it('reproduces the exact issue #41 scenario', () => {
    // This is the exact format from VS Code launch.json that was failing
    const out = parseDartDefinesFromArgs([
      '--dart-define',
      'oidc-client-id-web=1234567897894',
      '--dart-define',
      'grpc-url=test.test.test',
    ]);
    expect(out).toEqual({
      'oidc-client-id-web': '1234567897894',
      'grpc-url': 'test.test.test',
    });
  });
});
