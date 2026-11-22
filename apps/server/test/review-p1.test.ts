/**
 * Review fixes (P1): exact fines, honest OTHER, evidence limit, Demo Mode key.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { fineFor } from '../src/agent/rules/boston';
import { CaseStore, newCaseRecord } from '../src/core/store/cases';
import { JsonUserRepo } from '../src/core/store/users';
import { JsonAuditRepo } from '../src/core/store/audit';
import { EventHub } from '../src/core/hub';
import { upsertFact } from '../src/agent/policy/facts';
import { runTool } from '../src/agent/tools';
import { approvalPreview } from '../src/approval';
import { templateDraft } from '../src/agent/writer';
import type { Ctx } from '../src/core/ctx';

describe('fines are never guessed', () => {
  it('uses the amount printed on the ticket first', () => {
    expect(fineFor('METER FEE UNPAID', 45)).toMatchObject({ fine: 45, late: 8, basis: 'ticket' });
  });
  it('same category, different fine: an out-of-order meter is $25, not $40', () => {
    expect(fineFor('Meter Violation ("Out of Order")')).toEqual({ fine: 25, late: 8, basis: 'table' });
    expect(fineFor('METER FEE UNPAID')).toEqual({ fine: 40, late: 8, basis: 'table' });
  });
  it('falls back to a labelled category estimate, or nothing', () => {
    expect(fineFor('SOMETHING ELSE', undefined, 'HYDRANT')).toMatchObject({ fine: 100, basis: 'category' });
    expect(fineFor('SOMETHING ELSE')).toEqual({});
  });
});

function investigatingCase(violationType: 'METER' | 'OTHER') {
  const ctx: Ctx = { store: new CaseStore(null), hub: new EventHub(), users: new JsonUserRepo(null), audit: new JsonAuditRepo(null) };
  const c = newCaseRecord('en');
  c.state = 'INVESTIGATING';
  c.violationType = violationType;
  for (const [key, value] of [
    ['fullName', 'Alex Demo'],
    ['mailingAddress', '1 Demo St, Boston, MA 02215'],
    ['email', 'alex@example.com'],
  ])
    upsertFact(c, { key, label: key, value, provenance: 'PROFILE', status: 'CONFIRMED' });
  const said = upsertFact(c, {
    key: 'userAccount',
    label: 'Your account',
    value: 'I was only there for two minutes',
    provenance: 'USER_TEXT',
    status: 'USER_STATEMENT',
  });
  const rule = upsertFact(c, { key: 'rule:fine_amount', label: 'Fine', value: '$40', provenance: 'RULE', status: 'RULE_VERIFIED' });
  ctx.store.put(c);
  return { ctx, c, said, rule };
}

const other = (factIds: string[]) => ({
  recommendation: 'APPEAL',
  dispute_reason: 'OTHER',
  summary_user_lang: 'ok',
  grounds: [{ text_en: 'In my own words: I was only there for two minutes.', fact_ids: factIds }],
});

describe('honest triage: the model cannot invent an OTHER ground', () => {
  it('refuses OTHER on a playbook ticket unless the user chose to appeal anyway', async () => {
    const { ctx, c, said } = investigatingCase('METER');
    const out = await runTool(ctx, c.id, 'propose_outcome', other([said.id]));
    expect(out.isError).toBe(true);
    expect(ctx.store.must(c.id).state).toBe('INVESTIGATING');
  });
  it("allows OTHER after the user's explicit choice, but only citing their own statement", async () => {
    const { ctx, c, said, rule } = investigatingCase('METER');
    ctx.store.mutate(c.id, (r) => {
      r.appealAnyway = true;
    });
    expect((await runTool(ctx, c.id, 'propose_outcome', other([rule.id]))).isError).toBe(true);
    expect((await runTool(ctx, c.id, 'propose_outcome', other([said.id]))).isError).toBeFalsy();
    expect(ctx.store.must(c.id).state).toBe('FACTS_REVIEW');
  });
  it('allows OTHER for ticket types without a playbook (generic), still citing the user', async () => {
    const { ctx, c, said } = investigatingCase('OTHER');
    expect((await runTool(ctx, c.id, 'propose_outcome', other([said.id]))).isError).toBeFalsy();
  });
});

describe('evidence limit', () => {
  it('more than 5 portal attachments blocks approval with a clear message', () => {
    const c = newCaseRecord('en');
    const t = upsertFact(c, { key: 'ticketNumber', label: 'Ticket number', value: '900000001', provenance: 'TICKET_OCR', status: 'CONFIRMED' });
    c.draft = templateDraft(c, 'OTHER', [{ text: 'x', factIds: [t.id] }]);
    for (let i = 0; i < 6; i++)
      c.evidence.push({
        id: `e${i}`,
        kind: 'evidence_photo',
        filename: `p${i}.jpg`,
        mime: 'image/jpeg',
        bytes: 10,
        sha256: String(i).repeat(64).slice(0, 64),
        url: '',
        path: '',
        submitToPortal: true,
        createdAt: '',
      });
    expect(approvalPreview(c).missing.join(' ')).toContain('at most 5');
  });
});

describe('Demo Mode key', () => {
  const saved = { demoKey: config.demoKey, persist: config.persist };
  afterAll(() => Object.assign(config, saved));
  it('with DEMO_KEY set, /api needs the key (query once, then cookie); health stays open', async () => {
    Object.assign(config, { demoKey: 'k3y', persist: false });
    process.env.LOG_LEVEL = 'warn';
    const { buildServer } = await import('../src/index');
    const { app } = await buildServer();
    try {
      expect((await app.inject({ url: '/api/cases' })).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
      const first = await app.inject({ url: '/api/cases?key=k3y' });
      expect(first.statusCode).toBe(200);
      const cookie = String(first.headers['set-cookie']).split(';')[0];
      expect((await app.inject({ url: '/api/cases', headers: { cookie } })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/cases', headers: { cookie: 'ah_demo=wrong' } })).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
