// Safety checks for `npm run tunnel` (kept separate so they can be tested without starting a tunnel).
import fs from 'node:fs';

/** DEMO_KEY from the environment, else from the repo's .env file. */
export function readDemoKey(env = process.env, envFile = new URL('../.env', import.meta.url)) {
  if (env.DEMO_KEY) return env.DEMO_KEY.trim();
  try {
    const match = fs.readFileSync(envFile, 'utf8').match(/^\s*DEMO_KEY\s*=\s*(.*)$/m);
    return match?.[1].trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuse to publish the app unless the running server itself enforces the key:
 * the API must answer 401 without it and 200 with it.
 */
export async function preflight({ key, base, fetchImpl = fetch }) {
  if (!key || key.length < 12)
    return {
      ok: false,
      message:
        'DEMO_KEY is missing or shorter than 12 characters (an empty "DEMO_KEY=" line from .env.example counts as missing).\n' +
        'Set one, then restart the app (Ctrl+C, npm start):\n' +
        "  sed -i '' '/^DEMO_KEY=/d' .env && echo \"DEMO_KEY=$(openssl rand -hex 12)\" >> .env",
    };
  let health;
  try {
    health = await fetchImpl(`${base}/api/health`);
  } catch {
    health = undefined;
  }
  if (!health?.ok) return { ok: false, message: `The app is not running at ${base}. Start it first in another terminal: npm start` };
  const open = await fetchImpl(`${base}/api/cases`);
  if (open.status !== 401)
    return { ok: false, message: 'The running app does not enforce DEMO_KEY (it answered without the key). Stop it with Ctrl+C and run npm start again.' };
  const keyed = await fetchImpl(`${base}/api/cases`, { headers: { 'x-demo-key': key } });
  if (keyed.status !== 200) return { ok: false, message: 'DEMO_KEY in .env does not match the running app. Restart it with npm start.' };
  return { ok: true };
}

/** The quick-tunnel URL printed by cloudflared. */
export const tunnelUrl = (line) => line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
