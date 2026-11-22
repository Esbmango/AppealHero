import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type Page } from 'playwright';
import { buildPortal } from '../../mock-portal/src/index';
import { buildServer } from '../../server/src/index';
import { config } from '../../server/src/core/config';
import { t, type Lang } from '../src/i18n';
import type { CaseView } from '@appealhero/shared';

describe('phone acceptance through the real API and simulated portal', () => {
  let portal: Awaited<ReturnType<typeof buildPortal>>, server: Awaited<ReturnType<typeof buildServer>>, web: ViteDevServer, browser: Browser, page: Page;
  let base: string,
    lang: Lang = 'en';
  const label = (key: string, vars: Record<string, string | number> = {}) => t(key, vars, lang);
  const button = (key: string, vars?: Record<string, string | number>) => page.getByRole('button', { name: label(key, vars), exact: true });
  const heading = (key: string) => page.getByRole('heading', { name: label(key), exact: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'appealhero-wp9-'));

  beforeAll(async () => {
    portal = await buildPortal();
    const origin = await portal.listen({ host: '127.0.0.1', port: 0 });
    Object.assign(config, {
      dataDir: temp,
      aiMode: 'fake',
      mockPortalUrl: origin,
      execTiers: ['T1', 'T2'],
      demoKey: undefined,
      persist: false,
      headless: true,
    });
    process.env.LOG_LEVEL = 'silent';
    server = await buildServer();
    const api = await server.app.listen({ host: '127.0.0.1', port: 0 });
    const root = path.resolve(import.meta.dirname, '..');
    web = await createServer({
      root,
      configFile: path.join(root, 'vite.config.ts'),
      logLevel: 'error',
      server: { port: 0, host: '127.0.0.1', proxy: { '/api': { target: api, changeOrigin: true } } },
    });
    await web.listen();
    base = web.resolvedUrls!.local[0];
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  });
  afterAll(async () => {
    await browser?.close();
    await web?.close();
    await server?.app.close();
    await portal?.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await portal.inject({ url: '/admin/reset', method: 'POST' });
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(12000);
  });
  afterEach(async () => {
    await page?.context().close();
  });

  async function intake(language: Lang) {
    lang = language;
    await page.goto(base);
    await page.getByTestId('persona-' + (lang === 'es' ? 'maria' : 'lin')).click();
    await page.getByTestId('language-switch').selectOption(lang);
    await button('onboarding.continue').click();
  }
  async function state(): Promise<CaseView> {
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('cp.caseId')!));
    return (await page.request.get(new URL('/api/cases/' + id, base).href)).json();
  }
  async function sample(weekday: boolean) {
    if (!weekday) await page.getByLabel(label('intake.sampleType')).selectOption('meter');
    await button('intake.sample').click();
    await button('intake.start').click();
    if (weekday) await button('chat.sampleReceipt').click();
    await heading('review.factsTitle').waitFor();
  }
  async function approve() {
    await button('review.confirmAll').click();
    await heading('review.statementTitle').waitFor();
    await page.getByRole('checkbox').check();
    await button('review.approve').click();
    await heading('filing.submitted').waitFor();
    await page.getByRole('link', { name: label('filing.proof'), exact: true }).click();
    await page.reload();
    await page.getByTestId('proof-match').waitFor();
    expect(await page.getByTestId('proof-match').innerText()).toBe(label('filing.hashMatch'));
  }
  it("wp9: smoke (zh) completes Lin's path on a 390×844 viewport", async () => {
    await intake('zh');
    await sample(true);
    expect((await state()).triage?.disputeReason).toBe('PAID');
    await approve();
  });
  it("wp9: smoke (es) completes María's path", async () => {
    await intake('es');
    await sample(false);
    expect((await state()).metrics.questionsAsked).toBe(0);
    expect((await state()).triage?.strength).toBe('STRONG');
    await approve();
  });
  it('wp9: facts review blocks drafting while any fact is unconfirmed', async () => {
    await intake('en');
    await sample(false);
    const c = await state();
    expect(c.draft).toBeUndefined();
    expect((await page.request.post(new URL('/api/cases/' + c.id + '/facts/confirm', base).href, { data: { confirm: [], done: true } })).status()).toBe(422);
    await button('review.editField', { field: label('review.fields.fullName') }).click();
    expect(await button('review.confirmAll').isDisabled()).toBe(true);
    await page.getByRole('textbox', { name: label('review.fields.fullName'), exact: true }).fill('Lin Demo');
    await button('review.save').click();
    await page.getByText('Lin Demo', { exact: true }).waitFor();
    expect((await state()).state).toBe('FACTS_REVIEW');
  });
  it('wp9: statement edits invalidate the approval and require re-approval', async () => {
    await intake('en');
    await sample(false);
    await button('review.confirmAll').click();
    await heading('review.statementTitle').waitFor();
    const before = await state();
    await page.getByRole('checkbox').check();
    await button('review.editParagraph', { number: 1 }).click();
    const editor = page.getByRole('textbox', { name: label('review.editParagraph', { number: 1 }) });
    await editor.fill((await editor.inputValue()) + ' Please review this ticket.');
    await button('review.save').click();
    await page.getByText(label('review.userEdited'), { exact: true }).waitFor();
    expect(await button('review.approve').isDisabled()).toBe(true);
    expect((await state()).preview?.payloadHash).not.toBe(before.preview?.payloadHash);
    expect(
      (await page.request.post(new URL('/api/cases/' + before.id + '/approve', base).href, { data: { payloadHash: before.preview!.payloadHash } })).status(),
    ).toBe(409);
  });
  it('retries an out-of-state lookup and restores results before explicit selection', async () => {
    await intake('en');
    await button('intake.lookup').click();
    await button('intake.search').click();
    await page
      .getByRole('status')
      .filter({ hasText: label('intake.plate_lookup_ma_only') })
      .waitFor();
    await page.getByLabel(label('review.fields.ticketNumber'), { exact: true }).fill('999999999');
    await button('intake.search').click();
    await page
      .getByRole('status')
      .filter({ hasText: label('intake.not_found') })
      .waitFor();
    await page.getByLabel(label('intake.searchBy')).selectOption('plate');
    await page.getByLabel(label('review.fields.plateNumber')).fill('8KDW21');
    await page.getByLabel(label('review.fields.plateState')).selectOption('MA');
    await button('intake.search').click();
    await button('intake.chooseTicket', { number: '900000001' }).waitFor();
    await page.reload();
    await page.getByText(label('intake.status.PAID'), { exact: true }).first().waitFor();
    expect((await state()).ticket).toBeUndefined();
    await button('intake.chooseTicket', { number: '900000001' }).click();
    await heading('review.factsTitle').waitFor();
    expect((await state()).ticket?.source).toBe('PORTAL_LOOKUP');
  });
  it('shows a discretionary case with fees, selected circumstances and evidence upload', async () => {
    await intake('en');
    await page.getByText(label('intake.circumstances'), { exact: true }).click();
    await page.getByRole('button', { name: 'I am a student.', exact: true }).click();
    await page.getByRole('textbox', { name: label('intake.accountTitle') }).fill('No receipt.');
    await button('intake.sample').click();
    await button('intake.start').click();
    await heading('review.factsTitle').waitFor();
    expect(await page.getByTestId('case-strength').innerText()).toBe(label('review.strength.WEAK'));
    await page.getByText(label('review.lateFee'), { exact: true }).waitFor();
    await button('filing.acceptPay').waitFor();
    await page.getByText(label('review.evidenceToAdd'), { exact: true }).click();
    expect(await page.locator('input[type=file][aria-label^="Upload evidence"]').count()).toBeGreaterThan(0);
  });
});
