import { describe, expect, it } from 'vitest';
import { allTools } from '../src/tools.js';

describe('tool registry', () => {
  const tools = allTools();
  const names = tools.map((t) => t.name);

  it('exposes 15 tools', () => {
    expect(tools.length).toBe(15);
  });

  it('includes the core AT-SPI surface', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'get_status',
        'get_install_hint',
        'list_windows',
        'get_active_window',
        'get_node',
        'get_children',
        'get_text',
        'find_by_name',
        'find_by_role',
        'find_by_id',
        'click',
        'double_click',
        'type_text',
        'grab_focus',
        'wait_for',
      ]),
    );
  });

  it('tool names are unique', () => {
    const set = new Set(names);
    expect(set.size).toBe(names.length);
  });

  it('every tool has a non-empty description and JSON schema', () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputJsonSchema).toBeDefined();
      expect(tool.inputJsonSchema.type).toBe('object');
    }
  });

  it('node-id-keyed tools require nodeId in their schema', () => {
    const nodeIdTools = [
      'get_node',
      'get_children',
      'get_text',
      'click',
      'double_click',
      'type_text',
      'grab_focus',
    ];
    for (const name of nodeIdTools) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `missing tool ${name}`).toBeDefined();
      expect(tool!.inputJsonSchema.required).toContain('nodeId');
    }
  });

  it('type_text requires both nodeId and text', () => {
    const tool = tools.find((t) => t.name === 'type_text');
    expect(tool!.inputJsonSchema.required).toEqual(expect.arrayContaining(['nodeId', 'text']));
  });

  it('find_by_name requires name and allows exact + rootNodeId', () => {
    const tool = tools.find((t) => t.name === 'find_by_name');
    expect(tool!.inputJsonSchema.required).toEqual(['name']);
    expect(Object.keys(tool!.inputJsonSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['name', 'exact', 'rootNodeId']),
    );
  });

  it('wait_for accepts a discriminated criteria object', () => {
    const tool = tools.find((t) => t.name === 'wait_for');
    expect(tool!.inputJsonSchema.required).toEqual(['criteria']);
    const criteria = tool!.inputJsonSchema.properties?.criteria;
    expect(criteria?.type).toBe('object');
  });
});
