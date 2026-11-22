/**
 * End-to-end against the SIMULATED portal, fake AI mode (no key, no network).
 * Oracle = the mock portal's own record of what it received. Invariants checked per scenario:
 *   ≤ 1 appeal per ticket · submitted == approved · no submission without approval · correct terminal state
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseView, Scenario } from '@appealhero/shared';
import { config } from '../src/core/config';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TICKET = '900000001';
const DONE = ['SUBMITTED', 'NEEDS_USER', 'BLOCKED', 'FAILED', 'STATEMENT_REVIEW', 'CLOSED_NO_APPEAL'];

let api = '';
let portal = '';
let close: () => Promise<void> = async () => {};

beforeAll(async () => {
  const { buildPortal } = await import('../../mock-portal/src/index');
  const p = await buildPortal({ hangMs: 5000 });
  await p.listen({ port: 0, host: '127.0.0.1' });
  portal = `http://127.0.0.1:${(p.server.address() as { port: number }).port}`;
  Object.assign(config, {
    mockPortalUrl: portal,
    aiMode: 'fake',
    persist: false,
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'appealhero-')),
    submitTimeoutMs: 2000,
    execTiers: ['T1', 'T3'],
    headless: true,
    browserChannel: process.env.BROWSER_CHANNEL || undefined,
  });
  process.env.LOG_LEVEL = 'warn';
  const { buildServer } = await import('../src/index');
  const { app } = await buildServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  api = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  close = async () => {
    await app.close();
    await p.close();
  };
});
afterAll(() => close());

const getCase = async (id: string) => (await (await fetch(`${api}/api/cases/${id}`)).json()) as CaseView;
const post = (url: string, body: unknown) =>
  fetch(`${api}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function waitFor(id: string, pred: (c: CaseView) => boolean, ms = 60_000): Promise<CaseView> {
  const t0 = Date.now();
  for (;;) {
    const c = await getCase(id);
    if (pred(c)) return c;
    if (Date.now() - t0 > ms) throw new Error(`timeout; state=${c.state} history=${c.stateHistory.map((h) => h.to).join('>')}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function scenario(s: Scenario) {
  await fetch(`${portal}/admin/reset`, { method: 'POST' });
  await fetch(`${portal}/admin/scenario`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: s }) });
}

async function appeals(ticket = TICKET) {
  const st = (await (await fetch(`${portal}/admin/state`)).json()) as {
    appeals: { ticketNumber: string; statement: string; fullName: string; extra: Record<string, string>; evidence: unknown[] }[];
  };
  return st.appeals.filter((a) => a.ticketNumber === ticket);
}

async function createCase(text = '周日下午在 Comm Ave 停车，被开了计时器罚单') {
  const fd = new FormData();
  fd.append('ticket', new Blob([PNG_1PX], { type: 'image/png' }), 'ticket.png');
  fd.append('text', text);
  fd.append('lang', 'zh');
  fd.append('profileName', 'Alex Demo');
  fd.append('profileAddress', '1 Demo St, Boston, MA 02215');
  fd.append('profileEmail', 'alex.demo@example.com');
  const r = await fetch(`${api}/api/cases`, { method: 'POST', body: fd });
  expect(r.status).toBe(202);
  return ((await r.json()) as { caseId: string }).caseId;
}

/** v2: gate 1 (confirm every fact) → the writer drafts → gate 2 (approve the exact statement). */
async function confirmFacts(id: string) {
  let c = await waitFor(id, (x) => x.state === 'FACTS_REVIEW');
  expect(c.draft).toBeUndefined(); // nothing is written before the user confirms the facts
  expect(c.triage?.recommendation).toBe('APPEAL');
  // approving is impossible before there is a statement
  expect((await post(`/api/cases/${id}/approve`, { payloadHash: 'a'.repeat(64) })).status).toBe(409);
  const pending = c.facts.filter((f) => f.status === 'NEEDS_CONFIRMATION' || f.status === 'USER_STATEMENT').map((f) => f.id);
  expect(pending.length).toBeGreaterThan(0);
  // "done" without confirming everything is refused
  expect((await post(`/api/cases/${id}/facts/confirm`, { confirm: pending.slice(1), done: true })).status).toBe(422);
  expect((await post(`/api/cases/${id}/facts/confirm`, { confirm: pending, done: true })).status).toBe(202);
  c = await waitFor(id, (x) => x.state === 'STATEMENT_REVIEW');
  expect(c.stateHistory.map((h) => h.to)).toContain('DRAFTING');
  expect(c.draft?.revision).toBe(1);
  return c;
}

async function reviewAndApprove(id: string) {
  const c = await confirmFacts(id);
  expect(c.preview?.missing).toEqual([]);
  expect(c.preview!.unconfirmedFactIds).toEqual([]);
  const r = await post(`/api/cases/${id}/approve`, { payloadHash: c.preview!.payloadHash });
  expect(r.status).toBe(202);
  // double tap is idempotent
  const again = await post(`/api/cases/${id}/approve`, { payloadHash: c.preview!.payloadHash });
  expect(((await again.json()) as { idempotent: boolean }).idempotent).toBe(true);
  return c.preview!;
}

describe('AppealHero e2e (fake AI, simulated portal)', () => {
  it('normal: approve → fill → read-back → submit once → receipt', async () => {
    await scenario('normal');
    const id = await createCase();
    const preview = await reviewAndApprove(id);
    const c = await waitFor(id, (x) => DONE.includes(x.state));
    expect(c.state).toBe('SUBMITTED');
    expect(c.receipt?.source).toBe('confirmation_page');
    expect(c.receipt?.emailVerified).toBe(true);
    const a = await appeals();
    expect(a).toHaveLength(1);
    expect(a[0].statement.replace(/\r\n/g, '\n')).toBe(preview.payload.fields.statement);
    expect(a[0].fullName).toBe('Alex Demo');
    expect(a[0].evidence).toHaveLength(1);
    expect(c.metrics.tiers.T1).toBeGreaterThan(0);
    expect(c.metrics.tiers.T3 ?? 0).toBe(0);
  });

  it('redesign: semantic locators fail → Computer Use fallback (fake model) → still exactly one appeal', async () => {
    await scenario('redesign');
    const id = await createCase();
    await reviewAndApprove(id);
    const c = await waitFor(id, (x) => DONE.includes(x.state));
    expect(c.state).toBe('SUBMITTED');
    expect(c.metrics.tiers.T3).toBeGreaterThanOrEqual(5); // 6 text fields; ticket/plate/name/address/email/statement
    expect(c.metrics.cuSteps).toBeGreaterThan(0);
    expect(await appeals()).toHaveLength(1);
  });

  it('timeout after the portal recorded it → UNKNOWN_RESULT → status page → SUBMITTED, no duplicate', async () => {
    await scenario('submit_timeout_after_record');
    const id = await createCase();
    await reviewAndApprove(id);
    const c = await waitFor(id, (x) => DONE.includes(x.state));
    expect(c.state).toBe('SUBMITTED');
    expect(c.stateHistory.map((h) => h.to)).toContain('UNKNOWN_RESULT');
    expect(c.receipt?.source).toBe('status_page');
    expect(await appeals()).toHaveLength(1);
  });

  it('timeout before anything was recorded → reconcile proves NOT_FOUND → one safe retry → exactly one appeal', async () => {
    await scenario('submit_timeout_before_record');
    const id = await createCase();
    await reviewAndApprove(id);
    const c = await waitFor(id, (x) => DONE.includes(x.state));
    expect(c.state).toBe('SUBMITTED');
    expect(c.stateHistory.filter((h) => h.to === 'FILLING')).toHaveLength(2);
    expect(await appeals()).toHaveLength(1);
  });

  it('CAPTCHA → BLOCKED, nothing submitted, manual pack offered', async () => {
    await scenario('captcha');
    const id = await createCase();
    await reviewAndApprove(id);
    const c = await waitFor(id, (x) => DONE.includes(x.state));
    expect(c.state).toBe('BLOCKED');
    expect(c.manualPack?.length).toBeGreaterThan(5);
    expect(await appeals()).toHaveLength(0);
  });

  it('missing required field → NEEDS_USER → provide_info → old approval rejected → re-approve → SUBMITTED', async () => {
    await scenario('missing_field');
    const id = await createCase();
    const first = await reviewAndApprove(id);
    let c = await waitFor(id, (x) => DONE.includes(x.state));
    expect(c.state).toBe('NEEDS_USER');
    expect(c.needsUser?.code).toBe('MISSING_FIELD');
    expect(await appeals()).toHaveLength(0);
    const r = await post(`/api/jobs/${id}/resume`, { action: 'provide_info', field: c.needsUser!.field, value: 'Toyota' });
    expect(r.status).toBe(200);
    c = await getCase(id);
    expect(c.state).toBe('STATEMENT_REVIEW');
    expect(c.preview!.payloadHash).not.toBe(first.payloadHash);
    expect((await post(`/api/cases/${id}/approve`, { payloadHash: first.payloadHash })).status).toBe(409); // stale approval
    expect((await post(`/api/cases/${id}/approve`, { payloadHash: c.preview!.payloadHash })).status).toBe(202);
    c = await waitFor(id, (x) => DONE.includes(x.state) && x.state !== 'STATEMENT_REVIEW');
    expect(c.state).toBe('SUBMITTED');
    const a = await appeals();
    expect(a).toHaveLength(1);
    expect(a[0].extra['Vehicle make']).toBe('Toyota');
  });

  it('statement edits change the approval hash: the old hash is refused, the new one is accepted', async () => {
    await scenario('normal');
    const id = await createCase();
    const c = await confirmFacts(id);
    const oldHash = c.preview!.payloadHash;
    const paragraphs = c.draft!.paragraphs.map((p) => ({ text: p.text, factIds: p.factIds }));
    paragraphs.splice(paragraphs.length - 1, 0, { text: 'I was attending a medical appointment nearby.', factIds: [] });
    const r = await fetch(`${api}/api/cases/${id}/statement`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paragraphs }),
    });
    expect(r.status).toBe(200);
    const after = (await r.json()) as CaseView;
    expect(after.draft?.revision).toBe(2);
    expect(after.draft?.paragraphs.find((p) => p.text.startsWith('I was attending'))?.author).toBe('user');
    expect(after.preview!.payloadHash).not.toBe(oldHash);
    expect((await post(`/api/cases/${id}/approve`, { payloadHash: oldHash })).status).toBe(409);
    expect((await post(`/api/cases/${id}/approve`, { payloadHash: after.preview!.payloadHash })).status).toBe(202);
    const done = await waitFor(id, (x) => DONE.includes(x.state) && x.state !== 'STATEMENT_REVIEW');
    expect(done.state).toBe('SUBMITTED');
    const a = await appeals();
    expect(a).toHaveLength(1);
    expect(a[0].statement).toContain('medical appointment');
  });

  it('a chat message during statement review is a revision request: back through DRAFTING to a new revision', async () => {
    await scenario('normal');
    const id = await createCase();
    await confirmFacts(id);
    const fd = new FormData();
    fd.append('text', '写短一点');
    expect((await fetch(`${api}/api/cases/${id}/messages`, { method: 'POST', body: fd })).status).toBe(202);
    const c = await waitFor(id, (x) => x.state === 'STATEMENT_REVIEW' && x.draft?.revision === 2);
    expect(c.stateHistory.filter((h) => h.to === 'DRAFTING')).toHaveLength(2);
    expect(await appeals()).toHaveLength(0);
  });

  it('negative triage: hydrant with matching vehicle → PAY recommendation, user can close without appealing', async () => {
    await scenario('normal');
    const id = await createCase('我停在消防栓前面了');
    let c = await waitFor(id, (x) => Boolean(x.pendingQuestion));
    expect(c.pendingQuestion?.expects).toBe('choice');
    const fd = new FormData();
    fd.append('text', '一致');
    await fetch(`${api}/api/cases/${id}/messages`, { method: 'POST', body: fd });
    c = await waitFor(id, (x) => x.triage?.recommendation === 'PAY');
    expect(c.triage?.fineAmount).toBe(100);
    expect(c.state).toBe('INVESTIGATING');
    await post(`/api/cases/${id}/decision`, { choice: 'accept_pay' });
    c = await getCase(id);
    expect(c.state).toBe('CLOSED_NO_APPEAL');
    expect(await appeals('900000003')).toHaveLength(0);
  });

  it('network interlock: a submit POST that did not pass the gate never leaves the browser; real portals are hard-blocked', async () => {
    await scenario('normal');
    const { getBrowser } = await import('../src/portal/browser/browser');
    const { Interlock, installNetworkGuard } = await import('../src/portal/browser/guard');
    const browser = await getBrowser();
    const context = await browser.newContext();
    const blocked: string[] = [];
    await installNetworkGuard(context, {
      allowedOrigin: new URL(portal).origin,
      submitPath: /\/appeal\/submit$/,
      interlock: new Interlock(),
      onBlocked: (u) => blocked.push(u),
    });
    const page = await context.newPage();
    await page.goto(`${portal}/`);
    const outcome = await page.evaluate(async () => {
      try {
        await fetch('/appeal/submit', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'sid=x&attest=on' });
        return 'sent';
      } catch {
        return 'blocked';
      }
    });
    expect(outcome).toBe('blocked');
    await expect(page.goto('https://www.boston.gov/tickets')).rejects.toThrow();
    expect(blocked.some((u) => u.includes('boston.gov'))).toBe(true);
    await context.close();
  });
});
