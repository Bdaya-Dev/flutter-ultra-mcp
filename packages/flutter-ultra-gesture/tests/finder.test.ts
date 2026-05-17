import { describe, expect, it } from 'vitest';
import {
  FinderSchema,
  elementMatches,
  filterElements,
  resolveFinderToCoords,
  toNativeMatcherJson,
  type FinderSpec,
  type InteractiveElement,
} from '../src/finder.js';

describe('FinderSchema', () => {
  it('accepts key finder', () => {
    expect(FinderSchema.parse({ kind: 'key', value: 'btn-login' })).toEqual({
      kind: 'key',
      value: 'btn-login',
    });
  });

  it('defaults text.matchType to exact', () => {
    expect(FinderSchema.parse({ kind: 'text', value: 'Login' })).toEqual({
      kind: 'text',
      value: 'Login',
      matchType: 'exact',
    });
  });

  it('accepts nested descendant', () => {
    const finder: FinderSpec = FinderSchema.parse({
      kind: 'descendant',
      of: { kind: 'key', value: 'form' },
      matching: { kind: 'type', value: 'TextField' },
    });
    expect(finder).toEqual({
      kind: 'descendant',
      of: { kind: 'key', value: 'form' },
      matching: { kind: 'type', value: 'TextField' },
    });
  });

  it('rejects unknown kind', () => {
    expect(() => FinderSchema.parse({ kind: 'garbage', value: 'x' })).toThrow();
  });
});

describe('toNativeMatcherJson', () => {
  it('translates key to { key }', () => {
    expect(toNativeMatcherJson({ kind: 'key', value: 'btn' })).toEqual({
      key: 'btn',
    });
  });

  it('translates exact text to { text }', () => {
    expect(toNativeMatcherJson({ kind: 'text', value: 'Login', matchType: 'exact' })).toEqual({
      text: 'Login',
    });
  });

  it('returns null for contains text (needs server-side resolution)', () => {
    expect(
      toNativeMatcherJson({
        kind: 'text',
        value: 'log',
        matchType: 'contains',
      }),
    ).toBeNull();
  });

  it('translates coords with stringified values', () => {
    expect(toNativeMatcherJson({ kind: 'coords', x: 100, y: 200 })).toEqual({ x: '100', y: '200' });
  });

  it('returns null for tooltip / semantics / descendant', () => {
    expect(toNativeMatcherJson({ kind: 'tooltip', value: 'Save' })).toBeNull();
    expect(
      toNativeMatcherJson({
        kind: 'semantics',
        label: 'Close',
        matchType: 'exact',
      }),
    ).toBeNull();
    expect(
      toNativeMatcherJson({
        kind: 'descendant',
        of: { kind: 'key', value: 'a' },
        matching: { kind: 'key', value: 'b' },
      }),
    ).toBeNull();
  });
});

describe('elementMatches', () => {
  const baseElement: InteractiveElement = {
    type: 'TextField',
    key: 'login-username',
    text: 'login',
    bounds: { x: 50, y: 100, width: 200, height: 40 },
    visible: true,
    tooltip: 'Username',
    semanticsLabel: 'Email address input',
  };

  it('matches by key', () => {
    expect(elementMatches(baseElement, { kind: 'key', value: 'login-username' })).toBe(true);
    expect(elementMatches(baseElement, { kind: 'key', value: 'other' })).toBe(false);
  });

  it('matches text contains/regex/exact', () => {
    expect(
      elementMatches(baseElement, {
        kind: 'text',
        value: 'log',
        matchType: 'contains',
      }),
    ).toBe(true);
    expect(
      elementMatches(baseElement, {
        kind: 'text',
        value: '^lo.*n$',
        matchType: 'regex',
      }),
    ).toBe(true);
    expect(
      elementMatches(baseElement, {
        kind: 'text',
        value: 'login',
        matchType: 'exact',
      }),
    ).toBe(true);
  });

  it('matches coords-within-bounds', () => {
    expect(elementMatches(baseElement, { kind: 'coords', x: 150, y: 120 })).toBe(true);
    expect(elementMatches(baseElement, { kind: 'coords', x: 500, y: 500 })).toBe(false);
  });

  it('matches tooltip exact', () => {
    expect(elementMatches(baseElement, { kind: 'tooltip', value: 'Username' })).toBe(true);
  });

  it('matches semantics with contains', () => {
    expect(
      elementMatches(baseElement, {
        kind: 'semantics',
        label: 'Email',
        matchType: 'contains',
      }),
    ).toBe(true);
  });
});

describe('filterElements (descendant)', () => {
  const elements: InteractiveElement[] = [
    {
      type: 'Form',
      key: 'login-form',
      bounds: { x: 0, y: 0, width: 400, height: 600 },
      visible: true,
    },
    {
      type: 'TextField',
      key: 'username',
      bounds: { x: 50, y: 100, width: 300, height: 40 },
      visible: true,
    },
    {
      type: 'TextField',
      key: 'search', // outside the form
      bounds: { x: 500, y: 50, width: 200, height: 40 },
      visible: true,
    },
  ];

  it('restricts matches to those geometrically inside the ancestor', () => {
    const matches = filterElements(elements, {
      kind: 'descendant',
      of: { kind: 'key', value: 'login-form' },
      matching: { kind: 'type', value: 'TextField' },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.key).toBe('username');
  });
});

describe('resolveFinderToCoords', () => {
  const elements: InteractiveElement[] = [
    {
      type: 'IconButton',
      bounds: { x: 100, y: 200, width: 40, height: 40 },
      tooltip: 'Settings',
    },
  ];

  it('returns the centre of the first match', () => {
    const coords = resolveFinderToCoords(elements, {
      kind: 'tooltip',
      value: 'Settings',
    });
    expect(coords).toEqual({ x: 120, y: 220 });
  });

  it('returns null when no match', () => {
    expect(resolveFinderToCoords(elements, { kind: 'tooltip', value: 'Other' })).toBeNull();
  });
});
