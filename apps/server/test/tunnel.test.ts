/** `npm run tunnel` must never publish an app that answers without DEMO_KEY. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM helper without types
import { preflight, readDemoKey, tunnelUrl } from '../../../scripts/tunnel-lib.mjs';

const KEY = 'abcdef0123456789';
const fakeFetch = (opts: { up?: boolean; enforces?: boolean; key?: string }) => async (url: string, init?: { headers?: Record<string, string> }) => {
  if (!opts.up) throw new Error('ECONNREFUSED');
  if (url.endsWith('/api/health')) return { ok: true, status: 200 };
  const sent = init?.headers?.['x-demo-key'];
  if (!opts.enforces) return { ok: true, status: 200 };
  return sent === (opts.key ?? KEY) ? { ok: true, status: 200 } : { ok: false, status: 401 };
};

describe('tunnel preflight', () => {
  it('refuses without a long enough key', async () => {
    expect((await preflight({ key: undefined, base: 'x', fetchImpl: fakeFetch({ up: true, enforces: true }) })).ok).toBe(false);
    expect((await preflight({ key: 'short', base: 'x', fetchImpl: fakeFetch({ up: true, enforces: true }) })).ok).toBe(false);
  });
  it('refuses when the app is down, does not enforce the key, or uses another key', async () => {
    expect(await preflight({ key: KEY, base: 'x', fetchImpl: fakeFetch({ up: false }) })).toMatchObject({
      ok: false,
      message: expect.stringContaining('npm start'),
    });
    expect(await preflight({ key: KEY, base: 'x', fetchImpl: fakeFetch({ up: true, enforces: false }) })).toMatchObject({
      ok: false,
      message: expect.stringContaining('does not enforce'),
    });
    expect(await preflight({ key: KEY, base: 'x', fetchImpl: fakeFetch({ up: true, enforces: true, key: 'another-key-123' }) })).toMatchObject({
      ok: false,
      message: expect.stringContaining('does not match'),
    });
  });
  it('allows a running app that enforces the same key', async () => {
    expect(await preflight({ key: KEY, base: 'x', fetchImpl: fakeFetch({ up: true, enforces: true }) })).toEqual({ ok: true });
  });
  it('reads DEMO_KEY from the environment or .env and parses the tunnel URL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-env-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'GEMINI_API_KEY=x\nDEMO_KEY="from-file-123456"\n');
    expect(readDemoKey({}, file)).toBe('from-file-123456');
    expect(readDemoKey({ DEMO_KEY: 'from-env-123456' }, file)).toBe('from-env-123456');
    expect(readDemoKey({}, path.join(dir, 'missing'))).toBeUndefined();
    expect(tunnelUrl('INF |  https://quiet-river-abc.trycloudflare.com  |')).toBe('https://quiet-river-abc.trycloudflare.com');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
