// `enter_text` / `clear_text` — TextField input.

import { z } from 'zod';
import { callUltraExtension, stringifyArgs } from '../extension.js';
import { FinderSchema, toNativeMatcherJson } from '../finder.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const EnterTextInput = SessionIdInput.extend({
  finder: FinderSchema,
  input: z.string(),
});

const ClearTextInput = SessionIdInput.extend({
  finder: FinderSchema,
});

export function enterTextTool(
  registry: SessionRegistry,
): GestureTool<typeof EnterTextInput, z.ZodTypeAny> {
  return defineTool({
    name: 'enter_text',
    description:
      'Type `input` into the TextField matching `finder`. Use `{ kind: "focused" }` to target the currently-focused field.',
    inputSchema: EnterTextInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const native = toNativeMatcherJson(input.finder);
      if (native === null) {
        throw new Error(
          'enter_text only supports native finders (key/text-exact/type/coords/focused). ' +
            `Got finder kind '${input.finder.kind}'. Use \`tap\` first to focus the field, then \`enter_text\` with \`{ kind: "focused" }\`.`,
        );
      }
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.enterText',
        stringifyArgs({ ...native, input: input.input }),
      );
    },
  });
}

export function clearTextTool(
  registry: SessionRegistry,
): GestureTool<typeof ClearTextInput, z.ZodTypeAny> {
  return defineTool({
    name: 'clear_text',
    description: 'Clear text in the TextField matching `finder`. Equivalent to enter_text("").',
    inputSchema: ClearTextInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const native = toNativeMatcherJson(input.finder);
      if (native === null) {
        throw new Error(
          'clear_text only supports native finders. ' + `Got finder kind '${input.finder.kind}'.`,
        );
      }
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.clearText',
        stringifyArgs(native),
      );
    },
  });
}
