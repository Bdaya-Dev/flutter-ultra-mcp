// Shared input fragments used by every tool.

import { z } from 'zod';
import { FinderSchema } from '../finder.js';

export const SessionIdInput = z.object({
  sessionId: z.string().uuid(),
});

export const FinderInput = SessionIdInput.extend({
  finder: FinderSchema,
});

export type SessionIdInput = z.infer<typeof SessionIdInput>;
export type FinderInput = z.infer<typeof FinderInput>;
