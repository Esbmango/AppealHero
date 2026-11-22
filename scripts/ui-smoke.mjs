// Drives the real phone UI and API against the SIMULATED portal. Start npm start first.
// npm run smoke -- --lang zh|es|en; screenshots go to data/smoke/<lang>/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const lang = args.length ? (args[0] === '--lang' && args.length === 2 ? args[1] : '') : 'zh';
if (!['zh', 'es', 'en'].includes(lang)) throw new Error('Usage: npm run smoke -- --lang zh|es|en');
const dictionaries = Object.fromEntries(
  ['zh', 'es', 'en'].map((language) => [
    language,
    Object.fromEntries(
      ['common', 'onboarding', 'intake', 'chat', 'review', 'filing'].flatMap((namespace) =>
        Object.entries(JSON.parse(fs.readFileSync(new URL(`../apps/web/src/i18n/locales/${language}/${namespace}.json`, import.meta.url), 'utf8'))).map(
          ([key, value]) => [`${namespace}.${key}`, value],
        ),
      ),
    ),
  ]),
);
const T = (key, language = lang) => dictionaries[language][key];
const out = `${process.env.SMOKE_OUT || 'data/smoke'}/${lang}`;
fs.mkdirSync(out, { recursive: true });
const BASE = process.env.SMOKE_BASE || 'http://localhost:4000';
const PORTAL = process.env.SMOKE_PORTAL || 'http://localhost:4100';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, headless: true });
const log = (...values) => console.log('[smoke]', ...values);
const errors = [];
async function post(url, body = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(response.ok, `${url}: ${response.status}`);
}
async function checkPhone(page) {
  const smallTargets = await page.locator('.phone-flow').evaluate((root) => {
    const nodes = root.querySelectorAll(
      'button, select, textarea, input:not([type="checkbox"]), summary, label:has(input[type="file"]), label:has(input[type="checkbox"])',
    );
    return [...nodes]
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.width < 44 || rect.height < 44)
        );
      })
      .map((node) => ({
        text: node.textContent?.trim().slice(0, 80),
        tag: node.tagName,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      }));
  });
  assert.deepEqual(smallTargets, [], 'Every phone control must have a 44px hit area');
  const overflow = await page.locator('.phone-flow').evaluate((root) => root.scrollWidth > root.clientWidth + 1);
  assert.equal(overflow, false, 'Phone layout must not overflow horizontally');
}
async function phoneFlow(label) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(BASE + '/');
    // All personas set language and profile before any case is created.
    for (const [persona, language, name] of [
      ['lin', 'zh', 'Lin Xiaoyu'],
      ['maria', 'es', 'María González'],
      ['sam', 'en', 'Sam Carter'],
    ]) {
      await page.getByTestId(`persona-${persona}`).click();
      assert.equal(await page.getByTestId('language-switch').inputValue(), language);
      assert.equal(await page.locator('input[name="name"]').inputValue(), name);
    }
    const persona = lang === 'es' ? 'maria' : 'lin';
    const name = persona === 'maria' ? 'María González' : 'Lin Xiaoyu';
    await page.getByTestId(`persona-${persona}`).click();
    await page.getByTestId('language-switch').selectOption(lang);
    await checkPhone(page);
    await page.screenshot({ path: `${out}/${label}-0-onboarding.png` });
    await page.getByRole('button', { name: T('onboarding.continue'), exact: true }).click();
    await page.reload();
    assert.equal(await page.getByTestId('language-switch').inputValue(), lang);
    await page.getByRole('button', { name: T('intake.sample'), exact: true }).click();
    await page
      .getByRole('textbox', { name: T('intake.accountTitle'), exact: true })
      .fill(
        lang === 'zh'
          ? '周日下午在 Comm Ave 停车，被开了计时器罚单'
          : lang === 'es'
            ? 'Recibí una multa de parquímetro el domingo por la tarde en Comm Ave.'
            : 'I got a meter ticket on Sunday afternoon on Comm Ave.',
      );
    await checkPhone(page);
    await page.screenshot({ path: `${out}/${label}-1-intake.png` });
    const created = page.waitForResponse((response) => response.url() === BASE + '/api/cases' && response.request().method() === 'POST');
    await page.getByRole('button', { name: T('intake.start'), exact: true }).click();
    const response = await created;
    assert.equal(response.status(), 202);
    const { caseId } = await response.json();
    await page.getByRole('heading', { name: T('review.factsTitle'), exact: true }).waitFor({ timeout: 20000 });
    const currentCase = await (await fetch(`${BASE}/api/cases/${caseId}`)).json();
    assert.equal(currentCase.lang, lang);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('appealhero.profile.v1')));
    assert.equal(stored.name, name);
    for (const [key, value] of [
      ['fullName', stored.name],
      ['mailingAddress', stored.address],
      ['email', stored.email],
    ]) {
      assert.ok(
        currentCase.facts.some((fact) => fact.key === key && fact.value === value && fact.provenance === 'PROFILE' && fact.status === 'CONFIRMED'),
        `Profile fact ${key} must reach the server confirmed`,
      );
    }
    await checkPhone(page);
    await page.screenshot({ path: `${out}/${label}-2-facts.png`, fullPage: true });
    await page.getByRole('button', { name: T('review.confirmAll'), exact: true }).click();
    await page.getByRole('heading', { name: T('review.statementTitle'), exact: true }).waitFor({ timeout: 20000 });
    await checkPhone(page);
    await page.screenshot({ path: `${out}/${label}-3-statement.png`, fullPage: true });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: T('review.approve'), exact: true }).click();
    await page.getByRole('heading', { name: T('filing.submitted'), exact: true }).waitFor({ timeout: 40000 });
    await checkPhone(page);
    await page.screenshot({ path: `${out}/${label}-4-receipt.png`, fullPage: true });
    log(lang, label, 'phone flow, profile facts and 44px targets OK');
  } finally {
    await context.close();
  }
}
async function customProfile() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(BASE + '/');
    await page.getByTestId('persona-custom').click();
    await page.getByTestId('language-switch').selectOption('en');
    await page.locator('input[name="name"]').fill('Alex Demo');
    await page.locator('input[name="address"]').fill('1 Example St, Boston, MA 02215');
    await page.locator('input[name="email"]').fill('alex.demo@example.com');
    await page.getByRole('button', { name: T('onboarding.continue', 'en'), exact: true }).click();
    await page.reload();
    assert.equal(await page.getByTestId('language-switch').inputValue(), 'en');
    await page.getByRole('button', { name: T('onboarding.change', 'en'), exact: true }).click();
    assert.equal(await page.locator('input[name="name"]').inputValue(), 'Alex Demo');
    assert.equal(await page.locator('input[name="email"]').inputValue(), 'alex.demo@example.com');
    await page.getByTestId('language-switch').selectOption('es');
    await page.getByRole('heading', { name: T('onboarding.title', 'es'), exact: true }).waitFor();
    assert.equal(await page.locator('input[name="name"]').inputValue(), 'Alex Demo');
    await checkPhone(page);
    await page.screenshot({ path: `${out}/custom-profile.png` });
    log('custom profile persistence and live language switch OK');
  } finally {
    await context.close();
  }
}
try {
  await post(BASE + '/api/demo/reset');
  await customProfile();
  await phoneFlow('normal');
  await post(PORTAL + '/admin/reset');
  await post(BASE + '/api/demo/scenario', { scenario: 'redesign' });
  await phoneFlow('redesign');
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(BASE + '/');
  await page.getByText('AppealHero · Agent console', { exact: true }).waitFor();
  await page.getByTestId('language-switch').selectOption(lang);
  await page.getByRole('heading', { name: T('filing.submitted'), exact: true }).waitFor();
  await page.screenshot({ path: `${out}/desktop-console.png` });
  await desktop.close();
  assert.deepEqual(errors, [], 'Browser must not report unhandled errors');
  log('desktop console stays English; all checks passed');
} finally {
  await browser.close();
}
