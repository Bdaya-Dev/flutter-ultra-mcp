import { describe, expect, it } from 'vitest';
import {
  compactWidgetTree,
  compactWidgetRoot,
  compactTextDump,
  WIDGET_KEEP_FIELDS,
} from '../src/tools/inspect.js';

// ── compactWidgetTree ───────────────────────────────────────────────────────

describe('compactWidgetTree', () => {
  it('strips non-essential fields, keeping only WIDGET_KEEP_FIELDS members', () => {
    const node = {
      description: 'Text("Hello")',
      type: 'Text',
      hasChildren: false,
      valueId: 'inspector-42',
      createdByLocalProject: true,
      style: 'bodyMedium',
      // Fields that should be stripped:
      objectId: 'objects/abc123',
      renderObject: { runtimeType: 'RenderParagraph' },
      parentRenderElement: 'objects/parent',
      stateful: false,
      widgetRuntimeType: 'Text',
      locationId: 7,
      locationFile: '/lib/main.dart',
      locationLine: 42,
      locationColumn: 12,
    };

    const result = compactWidgetTree(node);
    expect(result).toHaveLength(1);

    const compacted = result[0]!;
    // Kept fields present:
    expect(compacted.description).toBe('Text("Hello")');
    expect(compacted.type).toBe('Text');
    expect(compacted.hasChildren).toBe(false);
    expect(compacted.valueId).toBe('inspector-42');
    expect(compacted.createdByLocalProject).toBe(true);
    expect(compacted.style).toBe('bodyMedium');

    // Stripped fields absent:
    expect(compacted).not.toHaveProperty('objectId');
    expect(compacted).not.toHaveProperty('renderObject');
    expect(compacted).not.toHaveProperty('parentRenderElement');
    expect(compacted).not.toHaveProperty('stateful');
    expect(compacted).not.toHaveProperty('widgetRuntimeType');
    expect(compacted).not.toHaveProperty('locationId');
    expect(compacted).not.toHaveProperty('locationFile');
    expect(compacted).not.toHaveProperty('locationLine');
    expect(compacted).not.toHaveProperty('locationColumn');
  });

  it('removes null, undefined, and empty-string values from kept fields', () => {
    const node = {
      description: 'Scaffold',
      type: 'Scaffold',
      style: '',           // empty string -> removed
      valueId: null,       // null -> removed
      createdByLocalProject: undefined, // undefined -> removed
      hasChildren: false,  // falsy but not null/undefined/'' -> kept
    };

    const result = compactWidgetTree(node);
    expect(result).toHaveLength(1);

    const compacted = result[0]!;
    expect(compacted.description).toBe('Scaffold');
    expect(compacted.type).toBe('Scaffold');
    expect(compacted.hasChildren).toBe(false);
    expect(compacted).not.toHaveProperty('style');
    expect(compacted).not.toHaveProperty('valueId');
    expect(compacted).not.toHaveProperty('createdByLocalProject');
  });

  it('preserves children recursively and strips them too', () => {
    const tree = {
      description: 'MaterialApp',
      type: 'MaterialApp',
      objectId: 'obj/1',
      children: [
        {
          description: 'Scaffold',
          type: 'Scaffold',
          objectId: 'obj/2',
          children: [
            {
              description: 'Text("Hello")',
              type: 'Text',
              objectId: 'obj/3',
              locationFile: '/lib/main.dart',
            },
          ],
        },
      ],
    };

    const result = compactWidgetTree(tree);
    expect(result).toHaveLength(1);

    const root = result[0]!;
    expect(root.description).toBe('MaterialApp');
    expect(root).not.toHaveProperty('objectId');

    const children = root.children as Record<string, unknown>[];
    expect(children).toHaveLength(1);
    expect(children[0]!.description).toBe('Scaffold');
    expect(children[0]!).not.toHaveProperty('objectId');

    const grandchildren = children[0]!.children as Record<string, unknown>[];
    expect(grandchildren).toHaveLength(1);
    expect(grandchildren[0]!.description).toBe('Text("Hello")');
    expect(grandchildren[0]!).not.toHaveProperty('objectId');
    expect(grandchildren[0]!).not.toHaveProperty('locationFile');
  });

  it('flattens nodes that have no identifying info (only children)', () => {
    // A wrapper node whose only kept fields are all null/empty, but has children.
    // Should be flattened: its children get promoted up.
    const tree = {
      objectId: 'obj/wrapper',        // stripped (not in keep-fields)
      renderObject: { type: 'Flex' }, // stripped
      children: [
        { description: 'Text("A")', type: 'Text' },
        { description: 'Text("B")', type: 'Text' },
      ],
    };

    const result = compactWidgetTree(tree);
    // The wrapper itself has no identifying info after stripping -> flattened
    expect(result).toHaveLength(2);
    expect(result[0]!.description).toBe('Text("A")');
    expect(result[1]!.description).toBe('Text("B")');
  });

  it('returns empty array for a node with no identifying info and no children', () => {
    const node = {
      objectId: 'obj/empty',
      renderObject: { type: 'RenderView' },
    };

    const result = compactWidgetTree(node);
    expect(result).toEqual([]);
  });

  it('handles deeply nested flattening across multiple levels', () => {
    // wrapper1 -> wrapper2 -> actual node
    // Both wrappers have no kept fields -> should flatten to just the leaf.
    const tree = {
      objectId: 'w1',
      children: [
        {
          objectId: 'w2',
          children: [
            { description: 'Leaf', type: 'Text' },
          ],
        },
      ],
    };

    const result = compactWidgetTree(tree);
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe('Leaf');
  });

  it('handles node with empty children array', () => {
    const node = {
      description: 'Container',
      type: 'Container',
      children: [],
    };

    const result = compactWidgetTree(node);
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe('Container');
    // Empty children array should not appear on result
    expect(result[0]!).not.toHaveProperty('children');
  });

  it('handles node with non-array children (treated as no children)', () => {
    const node = {
      description: 'Odd',
      type: 'Odd',
      children: 'not-an-array',
    };

    const result = compactWidgetTree(node);
    expect(result).toHaveLength(1);
    expect(result[0]!).not.toHaveProperty('children');
  });
});

// ── compactWidgetRoot ───────────────────────────────────────────────────────

describe('compactWidgetRoot', () => {
  it('returns the single compacted node when tree compacts to one root', () => {
    const tree = {
      description: 'MaterialApp',
      type: 'MaterialApp',
      objectId: 'obj/1',
      children: [
        { description: 'Scaffold', type: 'Scaffold', objectId: 'obj/2' },
      ],
    };

    const result = compactWidgetRoot(tree) as Record<string, unknown>;
    expect(result.description).toBe('MaterialApp');
    expect(result).not.toHaveProperty('objectId');
    const children = result.children as Record<string, unknown>[];
    expect(children).toHaveLength(1);
    expect(children[0]!.description).toBe('Scaffold');
  });

  it('wraps multiple results in {children} when root flattens to many', () => {
    // Root node has no kept fields, two children -> flattens to 2 nodes
    const tree = {
      objectId: 'wrapper',
      children: [
        { description: 'A', type: 'A' },
        { description: 'B', type: 'B' },
      ],
    };

    const result = compactWidgetRoot(tree) as Record<string, unknown>;
    expect(result).toHaveProperty('children');
    const children = result.children as Record<string, unknown>[];
    expect(children).toHaveLength(2);
    expect(children[0]!.description).toBe('A');
    expect(children[1]!.description).toBe('B');
  });

  it('passes through null input unchanged', () => {
    expect(compactWidgetRoot(null)).toBeNull();
  });

  it('passes through undefined input unchanged', () => {
    expect(compactWidgetRoot(undefined)).toBeUndefined();
  });

  it('passes through primitive input unchanged', () => {
    expect(compactWidgetRoot('hello')).toBe('hello');
    expect(compactWidgetRoot(42)).toBe(42);
  });
});

// ── compactTextDump ─────────────────────────────────────────────────────────

describe('compactTextDump', () => {
  it('filters blank lines', () => {
    const dump = 'RenderFlex(direction: horizontal)\n\n\nRenderText("Hi")';
    const result = compactTextDump(dump);
    expect(result).toBe('RenderFlex(direction: horizontal)\nRenderText("Hi")');
  });

  it('filters lines composed only of box-drawing characters', () => {
    const dump = [
      'RenderView#abc12',
      ' │',
      ' ├─child: RenderFlex#def34',
      ' │ │',
      ' └─child: RenderText#ghi56',
      '   ├└─┌┐┘┤┬┴┼',
    ].join('\n');

    const result = compactTextDump(dump);
    // Lines " │", " │ │", and "   ├└─┌┐┘┤┬┴┼" are box-only -> removed
    expect(result).toBe(
      'RenderView#abc12\n ├─child: RenderFlex#def34\n └─child: RenderText#ghi56',
    );
  });

  it('filters lines that are only a RenderObject class name with no properties', () => {
    const dump = [
      '  RenderFlex',
      '  RenderFlex(direction: horizontal)',
      '    RenderPositionedBox',
      '    RenderParagraph: "Hello"',
    ].join('\n');

    const result = compactTextDump(dump);
    // "  RenderFlex" and "    RenderPositionedBox" match renderClassOnly -> removed
    expect(result).toBe(
      '  RenderFlex(direction: horizontal)\n    RenderParagraph: "Hello"',
    );
  });

  it('trims deep indentation to max 6 levels (12 spaces)', () => {
    // 8 levels = 16 spaces -> should be trimmed to 12
    const deepLine = ' '.repeat(16) + 'RenderText("deep")';
    const shallowLine = ' '.repeat(4) + 'RenderFlex(direction: vertical)';
    const dump = `${shallowLine}\n${deepLine}`;

    const result = compactTextDump(dump);
    const lines = result.split('\n');
    expect(lines[0]).toBe('    RenderFlex(direction: vertical)');
    // Deep line trimmed: 12 spaces prefix instead of 16
    expect(lines[1]).toBe('            RenderText("deep")');
    // Verify the content is preserved
    expect(lines[1]!.trimStart()).toBe('RenderText("deep")');
    // Verify indent is exactly maxIndent = 12
    expect(lines[1]!.match(/^(\s*)/)?.[1]?.length).toBe(12);
  });

  it('preserves lines at or under the 6-level indent threshold', () => {
    const line = ' '.repeat(12) + 'RenderText("at-limit")';
    const result = compactTextDump(line);
    expect(result).toBe(line);
  });

  it('preserves lines with meaningful content like sizes and constraints', () => {
    const dump = [
      'RenderFlex#abc12 relayoutBoundary=up1',
      '  parentData: offset=Offset(0.0, 0.0) (can use size)',
      '  constraints: BoxConstraints(0.0<=w<=411.4, 0.0<=h<=683.4)',
      '  size: Size(411.4, 48.0)',
      '  direction: horizontal',
    ].join('\n');

    const result = compactTextDump(dump);
    // All lines have meaningful content -> all preserved
    expect(result).toBe(dump);
  });

  it('handles empty string input', () => {
    expect(compactTextDump('')).toBe('');
  });

  it('handles input with only blank and box lines', () => {
    const dump = '\n\n │\n├─\n\n';
    const result = compactTextDump(dump);
    expect(result).toBe('');
  });

  it('preserves semantics labels in the dump', () => {
    const dump = [
      'SemanticsNode#1',
      '  Rect.fromLTRB(0.0, 0.0, 411.4, 683.4)',
      '  label: "Submit Button"',
      '  actions: tap',
    ].join('\n');

    const result = compactTextDump(dump);
    expect(result).toBe(dump);
  });
});

// ── WIDGET_KEEP_FIELDS ──────────────────────────────────────────────────────

describe('WIDGET_KEEP_FIELDS', () => {
  it('contains the expected field set', () => {
    const expected = ['description', 'type', 'hasChildren', 'children', 'valueId',
      'createdByLocalProject', 'style'];
    for (const field of expected) {
      expect(WIDGET_KEEP_FIELDS.has(field)).toBe(true);
    }
    expect(WIDGET_KEEP_FIELDS.size).toBe(expected.length);
  });

  it('does not include common noise fields', () => {
    for (const noise of ['objectId', 'renderObject', 'parentRenderElement',
      'locationId', 'locationFile', 'locationLine', 'locationColumn',
      'stateful', 'widgetRuntimeType']) {
      expect(WIDGET_KEEP_FIELDS.has(noise)).toBe(false);
    }
  });
});
