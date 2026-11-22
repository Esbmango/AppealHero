// Renders the PNG icons the PWA manifest and iOS need from the brand SVGs (run after build_logos.py).
import { chromium } from 'playwright';
import fs from 'node:fs';
const pub = new URL('../../apps/web/public/', import.meta.url).pathname;
const jobs = [
  ['brand/app-icon.svg', 'icon-192.png', 192],
  ['brand/app-icon.svg', 'icon-512.png', 512],
  ['brand/app-icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['brand/app-icon.svg', 'apple-touch-icon.png', 180],
  ['favicon.svg', 'favicon-32.png', 32],
];
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  const svg = fs.readFileSync(pub + src, 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`,
  );
  await page.screenshot({ path: pub + out, omitBackground: true });
  console.log('wrote', out);
}
await browser.close();
