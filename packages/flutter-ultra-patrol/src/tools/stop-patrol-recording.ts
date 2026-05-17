// stop_patrol_recording — finalize the active recording.

import { z } from 'zod';
import { defineTool } from './types.js';

export const stopPatrolRecordingTool = defineTool({
  name: 'stop_patrol_recording',
  description:
    'Stop the active Patrol screen recording. Returns the on-disk path the recorder finalized to (as previously supplied to start_patrol_recording).',
  inputSchema: z.object({}),
  handler(_input, ctx) {
    const session = ctx.develop.get();
    if (!session) return { ok: false, reason: 'no_develop_session' };
    const sent = ctx.develop.send('recording stop');
    if (!sent) return { ok: false, reason: 'stdin_closed' };
    return {
      ok: true,
      taskId: session.id,
      dispatchedAt: ctx.now(),
    };
  },
});
