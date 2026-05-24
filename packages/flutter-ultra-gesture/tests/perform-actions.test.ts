import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Re-derive the schema locally so the test stays pure (no SessionRegistry
// dependency).  The source of truth for runtime validation remains
// src/tools/perform-actions.ts — these definitions must stay in sync.

const PointerDownStep = z.object({
  type: z.literal('pointerDown'),
  x: z.number(),
  y: z.number(),
});

const PointerMoveStep = z.object({
  type: z.literal('pointerMove'),
  x: z.number(),
  y: z.number(),
  duration: z.number().int().nonnegative().default(0),
});

const PointerUpStep = z.object({
  type: z.literal('pointerUp'),
});

const PauseStep = z.object({
  type: z.literal('pause'),
  duration: z.number().int().nonnegative(),
});

const ActionStep = z.discriminatedUnion('type', [
  PointerDownStep,
  PointerMoveStep,
  PointerUpStep,
  PauseStep,
]);

const PointerChain = z.object({
  pointerId: z.string().min(1),
  steps: z.array(ActionStep).min(1),
});

const PerformActionsInput = z
  .object({ sessionId: z.string().uuid() })
  .extend({ actions: z.array(PointerChain).min(1) });

const VALID_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('PerformActionsInput schema', () => {
  describe('valid inputs', () => {
    it('accepts a single-pointer chain with all four step types', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'finger-0',
            steps: [
              { type: 'pointerDown', x: 100, y: 200 },
              { type: 'pointerMove', x: 150, y: 250, duration: 100 },
              { type: 'pause', duration: 50 },
              { type: 'pointerUp' },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a multi-pointer action sequence (two-finger pinch)', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'finger-0',
            steps: [
              { type: 'pointerDown', x: 200, y: 300 },
              { type: 'pointerMove', x: 100, y: 300, duration: 200 },
              { type: 'pointerUp' },
            ],
          },
          {
            pointerId: 'finger-1',
            steps: [
              { type: 'pointerDown', x: 400, y: 300 },
              { type: 'pointerMove', x: 500, y: 300, duration: 200 },
              { type: 'pointerUp' },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('defaults pointerMove duration to 0 when omitted', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pointerMove', x: 50, y: 60 }],
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        const step = result.data.actions[0].steps[0] as { duration: number };
        expect(step.duration).toBe(0);
      }
    });

    it('accepts pause with duration 0', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pause', duration: 0 }],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts pointerUp with no extra fields', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'stylus',
            steps: [{ type: 'pointerDown', x: 0, y: 0 }, { type: 'pointerUp' }],
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('sessionId validation', () => {
    it('rejects a missing sessionId', () => {
      const result = PerformActionsInput.safeParse({
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pointerDown', x: 0, y: 0 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-UUID sessionId', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: 'not-a-uuid',
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pointerDown', x: 0, y: 0 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('actions array validation', () => {
    it('rejects an empty actions array', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects a pointer chain with an empty steps array', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [{ pointerId: 'p0', steps: [] }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects a pointer chain with an empty pointerId', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: '',
            steps: [{ type: 'pointerDown', x: 0, y: 0 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('step type validation', () => {
    it('rejects an unknown step type', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'hover', x: 10, y: 20 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects pointerDown without x', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pointerDown', y: 100 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects pointerDown without y', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pointerDown', x: 100 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects pointerMove without x', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pointerMove', y: 50 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects pointerMove without y', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pointerMove', x: 50 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects pause with a negative duration', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pause', duration: -1 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects pointerMove with a negative duration', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pointerMove', x: 10, y: 20, duration: -5 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects pointerMove with a float duration', () => {
      const result = PerformActionsInput.safeParse({
        sessionId: VALID_SESSION_ID,
        actions: [
          {
            pointerId: 'p0',
            steps: [{ type: 'pointerMove', x: 10, y: 20, duration: 1.5 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('ActionStep discriminated union', () => {
  it('parses each step type in isolation', () => {
    expect(ActionStep.safeParse({ type: 'pointerDown', x: 1, y: 2 }).success).toBe(true);
    expect(ActionStep.safeParse({ type: 'pointerMove', x: 1, y: 2 }).success).toBe(true);
    expect(ActionStep.safeParse({ type: 'pointerUp' }).success).toBe(true);
    expect(ActionStep.safeParse({ type: 'pause', duration: 100 }).success).toBe(true);
  });

  it('rejects a step with no type field', () => {
    expect(ActionStep.safeParse({ x: 1, y: 2 }).success).toBe(false);
  });
});
