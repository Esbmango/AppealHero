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
const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
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
  const layout = await page.locator('.phone-flow').evaluate((root) => {
    const header = root.querySelector('header').getBoundingClientRect();
    const scroll = root.querySelector('.flow-scroll');
    const composer = root.querySelector('.flow-composer')?.getBoundingClientRect();
    const shell = root.closest('main').getBoundingClientRect();
    return {
      overflow: [document.documentElement, root, scroll].some((node) => node.scrollWidth > node.clientWidth + 1),
      headerVisible: header.top >= 0 && header.bottom <= innerHeight,
      composerVisible: !composer || (composer.top >= header.bottom && composer.bottom <= innerHeight + 1),
      contentVisible: scroll.clientHeight > 0,
      centered: Math.abs(shell.left - (innerWidth - shell.right)) < 2,
      width: shell.width,
      inputsAvoidZoom: [...root.querySelectorAll('input, textarea, select')].every((node) => parseFloat(getComputedStyle(node).fontSize) >= 16),
    };
  });
  assert.equal(layout.overflow, false, 'Page and content must not overflow horizontally');
  assert.ok(layout.headerVisible && layout.composerVisible && layout.contentVisible, 'Header, content and composer must fit the viewport');
  assert.ok(layout.centered && layout.width <= 832, 'Single-column page must stay centered at a readable width');
  assert.ok(layout.inputsAvoidZoom, 'Inputs need 16px text to prevent iOS focus zoom');
  assert.equal(await page.getByText('AppealHero · Agent console', { exact: true }).count(), 0);
}
async function checkResponsive(page, stage) {
  const original = page.viewportSize();
  const caseId = await page.evaluate(() => localStorage.getItem('cp.caseId'));
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await checkPhone(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('cp.caseId')), caseId, 'Resizing must preserve the current case');
    if (stage === 'normal-onboarding' && [320, 768, 1440].includes(viewport.width)) {
      await page.screenshot({ path: `${out}/responsive-${viewport.width}.png`, scale: 'css' });
    }
  }
  await page.setViewportSize(original);
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
    await checkResponsive(page, `${label}-onboarding`);
    await page.screenshot({ path: `${out}/${label}-0-onboarding.png` });
    await page.getByRole('button', { name: T('onboarding.continue'), exact: true }).click();
    await page.reload();
    assert.equal(await page.getByTestId('language-switch').inputValue(), lang);
    const sunday = lang === 'es';
    if (sunday) await page.getByLabel(T('intake.sampleType'), { exact: true }).selectOption('meter');
    await page.getByRole('button', { name: T('intake.sample'), exact: true }).click();
    await checkResponsive(page, `${label}-intake`);
    await page.screenshot({ path: `${out}/${label}-1-intake.png` });
    const created = page.waitForResponse((response) => response.url() === BASE + '/api/cases' && response.request().method() === 'POST');
    await page.getByRole('button', { name: T('intake.start'), exact: true }).click();
    const response = await created;
    assert.equal(response.status(), 202);
    const { caseId } = await response.json();
    if (!sunday) await page.getByRole('button', { name: T('chat.sampleReceipt'), exact: true }).click();
    await page.getByRole('heading', { name: T('review.factsTitle'), exact: true }).waitFor({ timeout: 20000 });
    const currentCase = await (await fetch(`${BASE}/api/cases/${caseId}`)).json();
    assert.equal(currentCase.lang, lang);
    assert.equal(currentCase.triage.disputeReason, sunday ? 'METER_NOT_IN_EFFECT' : 'PAID');
    assert.equal(currentCase.triage.strength, 'STRONG');
    if (sunday) assert.equal(currentCase.metrics.questionsAsked, 0);
    if (!sunday) assert.ok(currentCase.facts.some((f) => f.key === 'receiptPlate' && f.value === 'KDT4821'));
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
    await checkResponsive(page, `${label}-facts`);
    await page.screenshot({ path: `${out}/${label}-2-facts.png`, fullPage: true });
    const editLabel = T('review.editField').replace('{field}', T('review.fields.fullName'));
    await page.getByRole('button', { name: editLabel, exact: true }).click();
    assert.equal(await page.getByRole('button', { name: T('review.confirmAll') }).isDisabled(), true);
    const editedName = stored.name + ' Demo';
    await page.getByRole('textbox', { name: T('review.fields.fullName'), exact: true }).fill(editedName);
    await page.getByRole('button', { name: T('review.save'), exact: true }).click();
    await page.getByText(editedName, { exact: true }).waitFor();
    await page.getByRole('button', { name: T('review.confirmAll'), exact: true }).click();
    await page.getByRole('heading', { name: T('review.statementTitle'), exact: true }).waitFor({ timeout: 20000 });
    await checkResponsive(page, `${label}-statement`);
    await page.screenshot({ path: `${out}/${label}-3-statement.png`, fullPage: true });
    const beforeEdit = await (await fetch(`${BASE}/api/cases/${caseId}`)).json();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: T('review.editParagraph').replace('{number}', '1'), exact: true }).click();
    const editor = page.getByRole('textbox', { name: T('review.editParagraph').replace('{number}', '1'), exact: true });
    const edited = (await editor.inputValue()) + ' Please review my appeal.';
    await editor.fill(edited);
    await page.getByRole('button', { name: T('review.save'), exact: true }).click();
    await page.getByText(T('review.userEdited'), { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: T('review.approve'), exact: true }).isDisabled(), true);
    const afterEdit = await (await fetch(`${BASE}/api/cases/${caseId}`)).json();
    assert.notEqual(beforeEdit.preview.payloadHash, afterEdit.preview.payloadHash);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: T('review.approve'), exact: true }).click();
    await page.getByRole('heading', { name: T('filing.submitted'), exact: true }).waitFor({ timeout: 40000 });
    await checkResponsive(page, `${label}-receipt`);
    await page.screenshot({ path: `${out}/${label}-4-receipt.png`, fullPage: true });
    await page.getByRole('link', { name: T('filing.proof'), exact: true }).click();
    await page.getByText(T('filing.hashMatch'), { exact: true }).waitFor();
    await page.getByRole('button', { name: T('filing.recheck'), exact: true }).click();
    await page
      .getByRole('status')
      .filter({ hasText: T('filing.statusFound').split('{time}')[0] })
      .waitFor();
    const trace = await page.getByRole('link', { name: T('filing.downloadTrace') }).getAttribute('href');
    assert.equal((await page.request.get(BASE + trace)).status(), 200);
    await checkResponsive(page, `${label}-proof`);
    log(lang, label, 'complete flow, profile facts, 44px targets and 8 viewport sizes OK');
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
  const listRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url() === BASE + '/api/cases') listRequests.push(request.url());
  });
  await page.goto(BASE + '/');
  await page.getByTestId('language-switch').selectOption(lang);
  await page.getByRole('heading', { name: T('onboarding.title'), exact: true }).waitFor();
  await page.getByTestId('persona-custom').click();
  await page.locator('input[name="name"]').fill('Desktop Draft');
  await checkResponsive(page, 'desktop-draft');
  assert.equal(await page.locator('input[name="name"]').inputValue(), 'Desktop Draft');
  assert.equal(await page.evaluate(() => localStorage.getItem('cp.caseId')), null, 'Fresh desktop must not take over another browser’s latest case');
  assert.deepEqual(listRequests, [], 'Website must not poll the presenter console case list');
  await page.screenshot({ path: `${out}/desktop-website.png` });
  await desktop.close();
  assert.deepEqual(errors, [], 'Browser must not report unhandled errors');
  log('desktop website preserves its own draft and does not follow other cases; all checks passed');
} finally {
  await browser.close();
}
