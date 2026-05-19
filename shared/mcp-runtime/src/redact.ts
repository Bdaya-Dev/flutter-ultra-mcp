// VM service URI token redaction — strips auth tokens from tool responses
// before they reach the LLM context.
//
// DDS WS URIs look like: ws://127.0.0.1:12345/AbCdEf123=/ws
// The token segment is the base64url path component between the port and /ws.

// Matches the base64url token segment between the host and the /ws suffix.
// Group 2 is the token (no slashes); group 3 is the /ws suffix or empty string.
// We exclude '/' from the token charset so the regex stops before '/ws'.
const VM_URI_TOKEN = /(wss?:\/\/[^/]+\/)([A-Za-z0-9_+=]+)(\/ws\b)?(?=\s|"|'|,|}|$)/g;

export function redactVmServiceToken(text: string): string {
  return text.replace(
    VM_URI_TOKEN,
    (_, prefix: string, _token: string, wsSuffix?: string) => `${prefix}***${wsSuffix ?? ''}`,
  );
}
