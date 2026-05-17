// `list_custom_extensions` enumerates user-registered `registerUltraExtension`
// callbacks.
//
// `call_custom_extension` invokes one by name with arbitrary string args.

import { z } from 'zod';
import { callUltraExtension, stringifyArgs } from '../extension.js';
import type { SessionRegistry } from '../session.js';
import { defineTool, type GestureTool } from './index.js';
import { SessionIdInput } from './common.js';

const ListInput = SessionIdInput;

const CallInput = SessionIdInput.extend({
  // Either the bare name (e.g. `myApp.fetchProfile`) which gets prefixed with
  // `ext.flutter.`, or the fully-qualified `ext.flutter.myApp.fetchProfile`.
  extensionName: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});

export function listCustomExtensionsTool(
  registry: SessionRegistry,
): GestureTool<typeof ListInput, z.ZodTypeAny> {
  return defineTool({
    name: 'list_custom_extensions',
    description:
      'List user-registered ultra extensions (via registerUltraExtension). Returns the name + description per entry.',
    inputSchema: ListInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        'ext.flutter.ultra.listExtensions',
      );
    },
  });
}

export function callCustomExtensionTool(
  registry: SessionRegistry,
): GestureTool<typeof CallInput, z.ZodTypeAny> {
  return defineTool({
    name: 'call_custom_extension',
    description:
      'Invoke a user-registered ultra extension by name. `args` is passed through as stringified parameters.',
    inputSchema: CallInput,
    handler: async (input) => {
      const handle = await registry.resolve(input.sessionId);
      const fullName = input.extensionName.startsWith('ext.flutter.')
        ? input.extensionName
        : `ext.flutter.${input.extensionName}`;
      return callUltraExtension(
        handle.client,
        handle.isolateId,
        fullName,
        stringifyArgs(input.args),
      );
    },
  });
}
