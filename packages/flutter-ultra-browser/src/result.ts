// MCP tool-return helpers. Per plan §16.3 default to text-content with
// stringified JSON, mirror in structuredContent.

import type { ToolReturn } from './watchdog.js';

export function ok<T>(data: T): ToolReturn {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as unknown,
  };
}

export function fail(message: string, hint?: string): ToolReturn {
  const text = hint ? `${message}\n\nHint: ${hint}` : message;
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

export function image(pngBase64: string, alt?: string): ToolReturn {
  const content: ToolReturn['content'] = [
    { type: 'image', data: pngBase64, mimeType: 'image/png' },
  ];
  if (alt) content.push({ type: 'text', text: alt });
  return { content };
}

export function tryFormatError(err: unknown): { message: string; hint: string } {
  if (err instanceof Error) {
    if (/Timeout/i.test(err.message)) {
      return {
        message: err.message,
        hint:
          'Increase the tool-specific timeoutMs argument, or split work into smaller steps. ' +
          'If a selector is the source of the timeout, verify with `evaluate_js` first.',
      };
    }
    if (/not found/i.test(err.message)) {
      return {
        message: err.message,
        hint: 'List active browsers/contexts/pages by calling `link_to_flutter` with no flutterSessionId, or relaunch via `launch_browser` if the browser process died.',
      };
    }
    return { message: err.message, hint: '' };
  }
  return { message: String(err), hint: '' };
}
