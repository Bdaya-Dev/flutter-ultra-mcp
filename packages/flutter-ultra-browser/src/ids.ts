// Compact opaque IDs (no Node UUID dep to keep dist small).
// Format: <prefix>_<8 base36 chars>

let counter = 0;

export function shortId(prefix: string): string {
  counter = (counter + 1) >>> 0;
  const rand = Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  const ctr = counter.toString(36).padStart(2, '0').slice(-2);
  return `${prefix}_${rand}${ctr}`;
}
