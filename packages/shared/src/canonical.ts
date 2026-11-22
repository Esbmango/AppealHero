/**
 * Canonical serialization for approval hashing. Works in Node and the browser.
 * - object keys sorted recursively, undefined dropped
 * - strings: Unicode NFC, CRLF/CR → LF, trailing spaces per line removed, trimmed
 * Without this, the same content can hash differently at approval time vs. read-back time.
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(normalizeText(value));
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}

/** Values are equal after normalization (used for DOM read-back). */
export const sameValue = (a: string, b: string) => normalizeText(a) === normalizeText(b);
