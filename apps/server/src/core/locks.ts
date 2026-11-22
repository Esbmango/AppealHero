/**
 * Per-case concurrency control.
 * - serial(): queue work per case (agent turns). A double-tapped "send" must never interleave two
 *   Gemini turns — the conversation history would get user/model/functionResponse blocks out of order.
 * - exclusive(): run only if nothing else holds the key (executor job and reconcile share one key),
 *   otherwise return false immediately. Two browsers must never race on the same case.
 */
const tails = new Map<string, Promise<void>>();

export function serial(key: string, fn: () => Promise<void>): Promise<void> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

const held = new Set<string>();

export async function exclusive(key: string, fn: () => Promise<void>): Promise<boolean> {
  if (held.has(key)) return false;
  held.add(key);
  try {
    await fn();
    return true;
  } finally {
    held.delete(key);
  }
}

export const isHeld = (key: string) => held.has(key);
