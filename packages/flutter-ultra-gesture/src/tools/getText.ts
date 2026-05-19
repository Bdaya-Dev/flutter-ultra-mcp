// `get_text` — read the text content from a widget matching the given finder.
//
// Calls ext.flutter.driver.getText via the VM service extension protocol.
// Falls back to interactiveElements resolution for server-side finders.

import { callUltraExtension, stringifyArgs } from '../extension.js';
import { FinderSchema, toNativeMatcherJson } from '../finder.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const GetTextInput = SessionIdInput.extend({
  finder: FinderSchema,
});

export function getTextTool(
  registry: SessionRegistry,
): GestureTool<typeof GetTextInput, ReturnType<typeof import('zod').z.any>> {
  return defineTool({
    name: 'get_text',
    description:
      'Read the text content of the widget matching `finder` via ext.flutter.driver.getText. ' +
      'Use native finders (key/text-exact/type/coords/focused) for best performance.',
    inputSchema: GetTextInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const native = toNativeMatcherJson(input.finder);

      if (native === null) {
        throw new Error(
          'get_text only supports native finders (key/text-exact/type/coords/focused). ' +
            `Got finder kind '${input.finder.kind}'.`,
        );
      }

      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.driver.getText',
        stringifyArgs(native),
      );
    },
  });
}
