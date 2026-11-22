// UI smoke test: drives the real web UI (phone + desktop viewports) against running services.
// Usage: npm start (or npm run dev with the API on :4000), then `npm run smoke`. Screenshots → data/smoke/
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.env.SMOKE_OUT || 'data/smoke';
fs.mkdirSync(out, { recursive: true });
const BASE = process.env.SMOKE_BASE || 'http://localhost:4000';
const PORTAL = process.env.SMOKE_PORTAL || 'http://localhost:4100';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, headless: true });
const log = (...a) => console.log('[smoke]', ...a);

async function phoneFlow(label, text) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('PAGE ERROR', e.message, (e.stack || '').split('\n').slice(0, 5).join(' | ')));
  await page.goto(BASE + '/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByText('使用示例罚单').click();
  await page.getByPlaceholder(/周日下午/).fill(text);
  await page.getByText('我的资料').click();
  await page.getByPlaceholder('全名（与车辆登记一致）').fill('Alex Demo');
  await page.getByPlaceholder('邮寄地址').fill('1 Demo St, Boston, MA 02215');
  await page.getByPlaceholder('邮箱（接收回执）').fill('alex.demo@example.com');
  await page.screenshot({ path: `${out}/${label}-1-intake.png` });
  await page.getByRole('button', { name: '开始处理这张罚单' }).click();
  // v2 gate 1: confirm every fact before anything is written
  await page.getByText('核对事实').waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${out}/${label}-2-facts.png`, fullPage: true });
  await page.getByRole('button', { name: '全部核对无误，开始写申诉信' }).click();
  // v2 gate 2: review the exact statement, then approve once
  await page.getByText('核对申诉信并授权').waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${out}/${label}-3-statement.png`, fullPage: true });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '批准并提交' }).click();
  await page.getByText('申诉已提交').waitFor({ timeout: 40000 });
  await page.screenshot({ path: `${out}/${label}-4-receipt.png`, fullPage: true });
  log(label, 'phone flow OK');
  await ctx.close();
}

await fetch(BASE + '/api/demo/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
await phoneFlow('normal', '周日下午在 Comm Ave 停车，被开了计时器罚单');

await fetch(PORTAL + '/admin/reset', { method: 'POST' });
await fetch(BASE + '/api/demo/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'redesign' }) });
await phoneFlow('redesign', '周日停车被开了罚单');

const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const dp = await desk.newPage();
dp.on('pageerror', (e) => log('PAGE ERROR', e.message));
await dp.goto(BASE + '/');
await dp.getByText('Agent console').waitFor();
await dp.waitForTimeout(2500);
await dp.screenshot({ path: `${out}/desktop-console.png` });
log('desktop OK');
await browser.close();
