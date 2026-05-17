import { describe, expect, it } from 'vitest';
import type { InspectorNode } from '../src/widgetTree.js';
import { findInTree, matchesFinder, walkTree } from '../src/widgetTree.js';

// Mini synthetic tree mimicking the inspector summary shape (Flutter 3.x).
const tree: InspectorNode = {
  description: 'MaterialApp',
  type: 'MaterialApp',
  children: [
    {
      description: 'Scaffold',
      type: 'Scaffold',
      children: [
        {
          description: 'Column',
          type: 'Column',
          children: [
            { description: 'Text("Hello")', type: 'Text' },
            { description: "ElevatedButton-[<'login_button'>]", type: 'ElevatedButton' },
            { description: 'Text("World")', type: 'Text' },
          ],
        },
      ],
    },
  ],
};

describe('walkTree', () => {
  it('visits every node depth-first', () => {
    const types: string[] = [];
    walkTree(tree, (node) => {
      if (node.type) types.push(node.type);
      return true;
    });
    expect(types).toEqual(['MaterialApp', 'Scaffold', 'Column', 'Text', 'ElevatedButton', 'Text']);
  });

  it('aborts early when visitor returns false', () => {
    const types: string[] = [];
    walkTree(tree, (node) => {
      if (node.type) types.push(node.type);
      return node.type !== 'Column';
    });
    expect(types).toEqual(['MaterialApp', 'Scaffold', 'Column']);
  });
});

describe('matchesFinder', () => {
  it('matches by key (description format)', () => {
    const btn: InspectorNode = { description: "ElevatedButton-[<'login_button'>]" };
    expect(matchesFinder(btn, { kind: 'key', value: 'login_button' })).toBe(true);
    expect(matchesFinder(btn, { kind: 'key', value: 'wrong' })).toBe(false);
  });

  it('matches by type', () => {
    const t: InspectorNode = { type: 'Text', widgetRuntimeType: 'Text' };
    expect(matchesFinder(t, { kind: 'type', value: 'Text' })).toBe(true);
  });

  it('matches by text exact', () => {
    const t: InspectorNode = { description: 'Text("Hello")' };
    expect(matchesFinder(t, { kind: 'text', value: 'Hello', matchType: 'exact' })).toBe(true);
    expect(matchesFinder(t, { kind: 'text', value: 'Goodbye', matchType: 'exact' })).toBe(false);
  });

  it('matches by text contains case-insensitive', () => {
    const t: InspectorNode = { description: 'Text("Welcome Home")' };
    expect(
      matchesFinder(t, {
        kind: 'text',
        value: 'welcome',
        matchType: 'contains',
        caseInsensitive: true,
      }),
    ).toBe(true);
  });

  it('coords hit-test against bounds', () => {
    const widget: InspectorNode = {
      size: [100, 50],
      transformToRoot: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1],
    };
    expect(matchesFinder(widget, { kind: 'coords', x: 50, y: 40 })).toBe(true);
    expect(matchesFinder(widget, { kind: 'coords', x: 200, y: 200 })).toBe(false);
  });
});

describe('findInTree', () => {
  it('finds widget by key', () => {
    const found = findInTree(tree, { kind: 'key', value: 'login_button' });
    expect(found).toHaveLength(1);
    expect(found[0]?.type).toBe('ElevatedButton');
    expect(found[0]?.depth).toBe(3);
  });

  it('returns no matches gracefully', () => {
    expect(findInTree(tree, { kind: 'key', value: 'absent' })).toEqual([]);
  });

  it('respects limit', () => {
    const found = findInTree(tree, { kind: 'type', value: 'Text' }, { limit: 1 });
    expect(found).toHaveLength(1);
  });

  it('reports ancestor chain', () => {
    const found = findInTree(tree, { kind: 'key', value: 'login_button' });
    expect(found[0]?.parentChain).toEqual(['MaterialApp', 'Scaffold', 'Column']);
  });
});
