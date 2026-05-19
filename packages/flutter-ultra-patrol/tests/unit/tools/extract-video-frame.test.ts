// Unit tests for extract_video_frame tool schema and metadata.
// Handler behaviour (ffmpeg execution) is not tested here — it requires
// ffmpeg in PATH and a real video file. Schema and registration are
// verifiable without any external processes.

import { describe, expect, it } from 'vitest';
import { extractVideoFrameTool } from '../../../src/tools/extract-video-frame.js';

describe('extract_video_frame — schema validation', () => {
  it('accepts a valid videoPath only (no timestamp or percent)', () => {
    expect(
      extractVideoFrameTool.inputSchema.safeParse({ videoPath: '/tmp/test.webm' }).success,
    ).toBe(true);
  });

  it('accepts videoPath + timestampMs', () => {
    expect(
      extractVideoFrameTool.inputSchema.safeParse({
        videoPath: '/tmp/test.mp4',
        timestampMs: 1500,
      }).success,
    ).toBe(true);
  });

  it('accepts videoPath + percent', () => {
    expect(
      extractVideoFrameTool.inputSchema.safeParse({
        videoPath: '/tmp/test.webm',
        percent: 50,
      }).success,
    ).toBe(true);
  });

  it('accepts videoPath + outputPath', () => {
    expect(
      extractVideoFrameTool.inputSchema.safeParse({
        videoPath: '/tmp/test.webm',
        outputPath: '/tmp/frame.png',
      }).success,
    ).toBe(true);
  });

  it('rejects empty videoPath', () => {
    expect(extractVideoFrameTool.inputSchema.safeParse({ videoPath: '' }).success).toBe(false);
  });

  it('rejects missing videoPath', () => {
    expect(extractVideoFrameTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('rejects negative timestampMs', () => {
    expect(
      extractVideoFrameTool.inputSchema.safeParse({
        videoPath: '/tmp/test.webm',
        timestampMs: -1,
      }).success,
    ).toBe(false);
  });

  it('rejects percent below 0', () => {
    expect(
      extractVideoFrameTool.inputSchema.safeParse({
        videoPath: '/tmp/test.webm',
        percent: -1,
      }).success,
    ).toBe(false);
  });

  it('rejects percent above 100', () => {
    expect(
      extractVideoFrameTool.inputSchema.safeParse({
        videoPath: '/tmp/test.webm',
        percent: 101,
      }).success,
    ).toBe(false);
  });

  it('schema accepts both timestampMs and percent (mutual-exclusion enforced in handler)', () => {
    // The .refine() approach wraps ZodObject in ZodEffects which breaks the server's
    // instanceof check — so the schema permits both and the handler returns { ok: false }.
    expect(
      extractVideoFrameTool.inputSchema.safeParse({
        videoPath: '/tmp/test.webm',
        timestampMs: 1000,
        percent: 50,
      }).success,
    ).toBe(true);
  });

  it('accepts percent at boundary values 0 and 100', () => {
    expect(
      extractVideoFrameTool.inputSchema.safeParse({ videoPath: '/tmp/t.webm', percent: 0 }).success,
    ).toBe(true);
    expect(
      extractVideoFrameTool.inputSchema.safeParse({ videoPath: '/tmp/t.webm', percent: 100 })
        .success,
    ).toBe(true);
  });

  it('rejects non-integer timestampMs', () => {
    expect(
      extractVideoFrameTool.inputSchema.safeParse({
        videoPath: '/tmp/test.webm',
        timestampMs: 1.5,
      }).success,
    ).toBe(false);
  });
});

describe('extract_video_frame — tool metadata', () => {
  it('has the correct name', () => {
    expect(extractVideoFrameTool.name).toBe('extract_video_frame');
  });

  it('has a non-empty description mentioning ffmpeg', () => {
    expect(extractVideoFrameTool.description.length).toBeGreaterThan(0);
    expect(extractVideoFrameTool.description.toLowerCase()).toContain('ffmpeg');
  });

  it('exposes a handler function', () => {
    expect(typeof extractVideoFrameTool.handler).toBe('function');
  });
});
