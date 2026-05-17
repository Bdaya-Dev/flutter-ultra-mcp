// Helpers for invoking `ext.flutter.ultra.*` service extensions and
// validating the standard envelope `{ type, method, status, ...payload }`.

import type { VmServiceClient } from '@flutter-ultra/vm-service-client';
import { z } from 'zod';

export const ExtensionEnvelopeSchema = z
  .object({
    type: z.string().optional(),
    method: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();
export type ExtensionEnvelope = z.infer<typeof ExtensionEnvelopeSchema>;

export type ExtensionArgs = Record<string, string>;

// Convert finder coords to stringified args — Dart's `WidgetMatcher.fromJson`
// re-parses every value via `double.tryParse(json[key].toString())`, so we
// always send strings.
export function stringifyArgs(args: Record<string, unknown>): ExtensionArgs {
  const out: ExtensionArgs = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === 'string' ? value : String(value);
  }
  return out;
}

export async function callUltraExtension<T = unknown>(
  client: VmServiceClient,
  isolateId: string,
  method: string,
  args: ExtensionArgs = {},
): Promise<T> {
  const raw = await client.callServiceExtension(method, {
    isolateId,
    args,
  });
  // Every ultra extension returns the envelope wrapper. We validate the
  // shape but return the full payload so callers can pick the fields they
  // care about.
  ExtensionEnvelopeSchema.parse(raw);
  return raw as T;
}
