/**
 * Mobile regressions in a real Chromium (simulated phones, not physical devices):
 * photo + library entry points, dictation de-duplication, recording review and limits, permission errors,
 * resync after the page becomes visible again, keyboard-sized viewport, agent activity.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AgentEvent, CaseView } from '@appealhero/shared';
import { buildPortal } from '../../mock-portal/src/index';
import { buildServer } from '../../server/src/index';
import { config } from '../../server/src/core/config';
import { t } from '../src/i18n';
import { mergeSegments, sessionSegments } from '../src/lib/speech';
import { agentActivity } from '../src/components/PhoneFlow';

const root = path.resolve(import.meta.dirname, '..');
const SAMPLE = path.join(root, 'public/sample-ticket-meter-weekday.png');
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const en = (key: string, vars: Record<string, string | number> = {}) => t(key, vars, 'en');

/** A stand-in SpeechRecognition that replays scripted result lists, like the browser would. */
const fakeRecognition = (script: { isFinal: boolean; text: string }[][]) => `
  (() => {
    const script = ${JSON.stringify(script)};
    let session = 0;
    class FakeRecognition {
      constructor() { this.continuous = false; this.interimResults = false; this.lang = ''; window.__ahRecognition = (window.__ahRecognition || []).concat({ continuous: () => this.continuous, lang: () => this.lang }); }
      start() {
        const steps = script[session++] || [];
        let i = 0;
        const next = () => {
          if (this._stopped) return;
          if (i < steps.length) {
            const results = steps[i++].map((r) => Object.assign([{ transcript: r.text }], { isFinal: r.isFinal }));
            this.onresult && this.onresult({ resultIndex: 0, results });
            setTimeout(next, 30);
          } else setTimeout(() => this.onend && this.onend(), 30);
        };
        setTimeout(next, 30);
      }
      stop() { this._stopped = true; setTimeout(() => this.onend && this.onend(), 10); }
    }
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
  })();`;
const r = (text: string, isFinal = true) => ({ text, isFinal });

describe('mobile experience', () => {
  let portal: Awaited<ReturnType<typeof buildPortal>>, server: Awaited<ReturnType<typeof buildServer>>, web: ViteDevServer, browser: Browser;
  let base: string, api: string;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'appealhero-mobile-'));

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
    api = await server.app.listen({ host: '127.0.0.1', port: 0 });
    web = await createServer({
      root,
      configFile: path.join(root, 'vite.config.ts'),
      logLevel: 'error',
      server: { port: 0, host: '127.0.0.1', proxy: { '/api': { target: api, changeOrigin: true } } },
    });
    await web.listen();
    // localhost is a secure context, so getUserMedia works; the fake device gives MediaRecorder real audio.
    base = web.resolvedUrls!.local[0].replace('127.0.0.1', 'localhost');
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || undefined,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    });
  });
  afterAll(async () => {
    await browser?.close();
    await web?.close();
    await server?.app.close();
    await portal?.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  async function phone(opts: { android?: boolean; init?: string; permissions?: string[] } = {}): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: opts.android ? ANDROID_UA : undefined,
      permissions: opts.permissions ?? ['microphone'],
    });
    if (opts.init) await context.addInitScript(opts.init);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(base);
    await page.getByTestId('choose-lang-en').click();
    await page.getByTestId('persona-sam').click();
    await page.getByRole('button', { name: en('onboarding.continue'), exact: true }).click();
    return { context, page };
  }
  const story = (page: Page) => page.getByRole('textbox', { name: en('intake.accountTitle'), exact: true });

  it('merges dictation results without repeats', () => {
    expect(mergeSegments(['I', 'I paid', 'I paid for parking'], 'en')).toBe('I paid for parking');
    expect(mergeSegments(['I paid for parking', 'I paid for parking', 'but got a ticket'], 'en')).toBe('I paid for parking but got a ticket');
    expect(mergeSegments(['我当时', '我当时已经付过', '我当时已经付过停车费了', '但还是收到罚单'], 'zh')).toBe('我当时已经付过停车费了但还是收到罚单');
    expect(mergeSegments(['Pagué el estacionamiento.', 'pagué el estacionamiento', 'y recibí una multa'], 'es')).toBe(
      'Pagué el estacionamiento. y recibí una multa',
    );
    const list = Object.assign([Object.assign([{ transcript: 'one' }], { isFinal: true }), Object.assign([{ transcript: 'tw' }], { isFinal: false })], {});
    expect(sessionSegments(list as never)).toEqual({ finals: ['one'], interim: 'tw' });
  });

  it('Android: one utterance per session, cumulative duplicates removed, text stays editable and unsent', async () => {
    const { context, page } = await phone({
      android: true,
      init: fakeRecognition([
        [[r('I', false)], [r('I paid', false)], [r('I paid')], [r('I paid'), r('I paid for parking')]],
        [[r('but I still', false)], [r('but I still got a ticket')]],
      ]),
    });
    try {
      await story(page).fill('');
      await page.getByTestId('mic').click();
      await expect.poll(() => story(page).inputValue(), { timeout: 8000 }).toBe('I paid for parking but I still got a ticket');
      expect(
        await page.evaluate(() => (window as unknown as { __ahRecognition: { continuous: () => boolean }[] }).__ahRecognition.map((x) => x.continuous())),
      ).toEqual(expect.arrayContaining([false]));
      await page.getByTestId('mic').click(); // stop
      await story(page).fill((await story(page).inputValue()) + ' (edited)');
      expect(await story(page).inputValue()).toContain('(edited)');
      expect(await page.evaluate(() => localStorage.getItem('cp.caseId'))).toBeNull();
    } finally {
      await context.close();
    }
  });

  it('desktop/iOS continuous mode replaces interim text and keeps typed text in front', async () => {
    const { context, page } = await phone({
      init: fakeRecognition([
        [[r('I paid', false)], [r('I paid for parking', false)], [r('I paid for parking')], [r('I paid for parking'), r('at nine', false)]],
      ]),
    });
    try {
      await story(page).fill('Note:');
      await page.getByTestId('mic').click();
      await expect.poll(() => story(page).inputValue(), { timeout: 8000 }).toBe('Note: I paid for parking at nine');
      expect(await page.evaluate(() => (window as unknown as { __ahRecognition: { lang: () => string }[] }).__ahRecognition[0].lang())).toBe('en-US');
    } finally {
      await context.close();
    }
  });

  it('recording: timer, auto-stop at the limit, play / record again / delete, and nothing is used until confirmed', async () => {
    const { context, page } = await phone({ init: 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.__ahMaxRecordMs = 1500;' });
    try {
      await page.getByTestId('mic').click();
      await expect.poll(() => page.getByTestId('mic').innerText()).toMatch(/0:0\d \/ 0:01/);
      const review = page.getByTestId('recording-review');
      await review.waitFor({ timeout: 8000 }); // stopped by itself at 1.5 s
      expect(await review.locator('audio').count()).toBe(1);
      expect(await page.getByTestId('intake-audio').count()).toBe(0);
      await review.getByRole('button', { name: en('chat.deleteRecording'), exact: true }).click();
      await page.getByTestId('mic').waitFor();
      await page.getByTestId('mic').click();
      await review.waitFor({ timeout: 8000 });
      await review.getByRole('button', { name: en('chat.reRecord'), exact: true }).click();
      await review.waitFor({ state: 'detached' });
      await review.waitFor({ timeout: 8000 });
      await review.getByRole('button', { name: en('chat.useRecording'), exact: true }).click();
      await page.getByTestId('intake-audio').waitFor();
      await page
        .getByTestId('intake-audio')
        .getByRole('button', { name: en('chat.deleteRecording'), exact: true })
        .click();
      expect(await page.getByTestId('intake-audio').count()).toBe(0);
    } finally {
      await context.close();
    }
  });

  it('explains a denied or missing microphone instead of failing silently', async () => {
    for (const [name, key] of [
      ['NotAllowedError', 'chat.micDenied'],
      ['NotFoundError', 'chat.micMissing'],
    ] as const) {
      const { context, page } = await phone({
        init: `delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
          navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('blocked', '${name}'));`,
      });
      try {
        await page.getByTestId('mic').click();
        await page
          .getByRole('alert')
          .filter({ hasText: en(key) })
          .waitFor();
      } finally {
        await context.close();
      }
    }
  });

  it('ticket photo: camera and library entry points, thumbnail, remove, replace', async () => {
    const { context, page } = await phone();
    try {
      const picker = page.getByTestId('photo-picker').first();
      expect(await picker.getByTestId('photo-camera').getAttribute('capture')).toBe('environment');
      expect(await picker.getByTestId('photo-gallery').getAttribute('capture')).toBeNull();
      await picker.getByTestId('photo-gallery').setInputFiles(SAMPLE);
      await picker.getByRole('img', { name: en('common.photo.thumb', { n: 1 }) }).waitFor();
      await picker.getByTestId('photo-remove').click();
      expect(await picker.getByRole('img').count()).toBe(0);
      expect(await page.getByRole('button', { name: en('intake.start'), exact: true }).isDisabled()).toBe(true);
      await picker.getByTestId('photo-camera').setInputFiles(SAMPLE);
      await picker.getByTestId('photo-gallery').setInputFiles(path.join(root, 'public/sample-ticket-permit.png'));
      expect(await picker.getByRole('img').count()).toBe(1); // a ticket is one photo: the new one replaces it
      expect(await page.getByRole('button', { name: en('intake.start'), exact: true }).isDisabled()).toBe(false);
    } finally {
      await context.close();
    }
  });

  it('after the stream drops (screen locked), returning to the page shows the latest case; the shell follows a keyboard-sized viewport', async () => {
    const { context, page } = await phone();
    try {
      await page.getByRole('button', { name: en('intake.sample'), exact: true }).click();
      const created = page.waitForResponse((res) => res.url().endsWith('/api/cases') && res.request().method() === 'POST');
      await page.getByRole('button', { name: en('intake.start'), exact: true }).click();
      const { caseId } = (await (await created).json()) as { caseId: string };
      await page.getByRole('button', { name: en('chat.sampleReceipt'), exact: true }).waitFor();
      // Simulate a dead stream: no events reach the page any more.
      await page.route('**/api/cases/*/stream', (route) => route.abort());
      await page.reload();
      await page.getByRole('button', { name: en('chat.sampleReceipt'), exact: true }).waitFor();
      const before = await page.locator('.phone-flow').innerText();
      const form = new FormData();
      form.set('text', 'I lost my receipt, sorry.');
      const res = await fetch(`${api}/api/cases/${caseId}/messages`, { method: 'POST', body: form });
      expect(res.status).toBeLessThan(300);
      await page.waitForTimeout(500);
      expect(await page.locator('.phone-flow').innerText()).toBe(before); // nothing arrives while the stream is down
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.getByText('I lost my receipt, sorry.', { exact: true }).waitFor({ timeout: 8000 });

      // Keyboard: the visible viewport shrinks; the app shell and the composer must fit inside it.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'))).toBe('844px');
      await page.setViewportSize({ width: 390, height: 480 });
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'))).toBe('480px');
      const composer = await page.locator('.flow-composer').boundingBox();
      if (composer) expect(composer.y + composer.height).toBeLessThanOrEqual(481);
    } finally {
      await context.close();
    }
  });

  it('agent activity comes from the case state and this turn’s tool calls', () => {
    const base = { state: 'INVESTIGATING', messages: [], triage: undefined } as unknown as CaseView;
    const user = { id: 'm1', role: 'user', text: 'hi', at: '' } as const;
    const agent = { id: 'm2', role: 'agent', text: 'q?', at: '' } as const;
    const tool = (name: string) => ({ type: 'agent.tool', caseId: 'c', name, args: {}, result: {}, ms: 1 }) as AgentEvent;
    const said = { type: 'agent.message', caseId: 'c', message: user } as AgentEvent;
    expect(agentActivity({ ...base, state: 'IDENTIFYING' } as CaseView, [])).toBe('identifying');
    expect(agentActivity({ ...base, state: 'DRAFTING' } as CaseView, [])).toBe('drafting');
    expect(agentActivity({ ...base, messages: [user, agent] } as CaseView, [])).toBeNull();
    expect(agentActivity({ ...base, messages: [user] } as CaseView, [])).toBe('investigating');
    expect(agentActivity({ ...base, messages: [{ ...user, evidenceIds: ['e1'] }] } as CaseView, [])).toBe('evidence');
    expect(agentActivity({ ...base, messages: [user] } as CaseView, [tool('check_rule'), said])).toBe('investigating'); // tool from an earlier turn
    expect(agentActivity({ ...base, messages: [user] } as CaseView, [said, tool('check_rule')])).toBe('rules');
    expect(agentActivity({ ...base, state: 'FACTS_REVIEW', messages: [user] } as CaseView, [])).toBeNull();
  });
});
