// Server-level invariants: 15 tools exposed, names unique, every input
// schema is a ZodObject, every description fits inside the MCP soft limit.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS, createPatrolServer } from '../../src/server.js';

describe('TOOLS catalogue', () => {
  it('exports exactly 15 tools (13 per plan §17B.1 + extract_video_frame #43 + run_patrol_doctor #83)', () => {
    expect(TOOLS).toHaveLength(15);
  });

  it('has unique tool names', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists every named tool from the plan', () => {
    const expected = [
      'list_tests',
      'start_patrol_test',
      'poll_patrol_job',
      'get_patrol_result',
      'cancel_patrol_job',
      'start_patrol_develop',
      'patrol_develop_run',
      'patrol_hot_reload',
      'take_patrol_screenshot',
      'start_patrol_recording',
      'stop_patrol_recording',
      'get_patrol_browser_errors',
      'get_patrol_web_debugger_port',
      'extract_video_frame',
      'run_patrol_doctor',
    ];
    expect(TOOLS.map((t) => t.name).sort()).toEqual(expected.sort());
  });

  it('every tool has a Zod object input schema', () => {
    for (const t of TOOLS) {
      expect(t.inputSchema instanceof z.ZodObject).toBe(true);
    }
  });

  it('keeps every description under 1000 chars', () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeLessThan(1000);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

describe('createPatrolServer', () => {
  it('wires the MCP server with default in-memory state', () => {
    const { server, ctx } = createPatrolServer();
    expect(server).toBeDefined();
    expect(ctx.jobs).toBeDefined();
    expect(ctx.develop).toBeDefined();
    expect(typeof ctx.now).toBe('function');
  });
});
