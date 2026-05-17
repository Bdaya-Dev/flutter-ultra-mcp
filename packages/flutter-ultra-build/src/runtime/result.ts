/**
 * Helpers for building CallToolResult payloads per plan §16.3.
 *
 * - `ok()` returns a success result with stringified JSON + mirrored
 *   structuredContent (clients that prefer typed parsing get it).
 * - `okText()` for plain text.
 * - `err()` for expected failures the LLM should reason about — always
 *   `isError: true` with a remediation hint baked into the message.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function okJson<T extends Record<string, unknown> | unknown[]>(data: T): CallToolResult {
  const text = JSON.stringify(data, null, 2);
  if (Array.isArray(data)) {
    return {
      content: [{ type: 'text', text }],
      structuredContent: { items: data } as Record<string, unknown>,
    };
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent: data as Record<string, unknown>,
  };
}

export function okText(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function err(message: string, remediation?: string): CallToolResult {
  const text = remediation ? `${message}\n\nRemediation: ${remediation}` : message;
  return {
    isError: true,
    content: [{ type: 'text', text }],
  };
}

export function errFromException(e: unknown, remediation?: string): CallToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  return err(msg, remediation);
}
