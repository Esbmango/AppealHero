// HTTPS address for testing on a phone (camera and microphone need HTTPS).
// Usage: npm start (terminal 1), then npm run tunnel (terminal 2). Requires cloudflared: brew install cloudflared
import { spawn, spawnSync } from 'node:child_process';
import { preflight, readDemoKey, tunnelUrl } from './tunnel-lib.mjs';

const base = `http://localhost:${process.env.PORT || 4000}`;
const key = readDemoKey();
const check = await preflight({ key, base });
if (!check.ok) {
  console.error(`\n✗ Not starting the tunnel.\n${check.message}\n`);
  process.exit(1);
}
if (spawnSync('cloudflared', ['--version']).error) {
  console.error('\n✗ cloudflared is not installed. Install it with: brew install cloudflared\n');
  process.exit(1);
}
console.log('Starting an HTTPS tunnel (cloudflared quick tunnel)… Ctrl+C stops it.');
const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', base], { stdio: ['ignore', 'pipe', 'pipe'] });
let shown = false;
const watch = (chunk) => {
  const url = tunnelUrl(String(chunk));
  if (!url || shown) return;
  shown = true;
  console.log(`\n✓ Open this on your phone (Safari / Chrome):\n\n   ${url}/?key=${encodeURIComponent(key)}\n`);
  console.log('  The key is stored as a cookie after the first visit. Anyone with this link can use the demo, so share it only with your team.\n');
};
child.stdout.on('data', watch);
child.stderr.on('data', watch);
const stop = () => child.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
