import { describe, expect, it } from 'vitest';
import { ADAPTER_VERSION } from '@appealhero/shared';
import { approvalPreview, buildApprovalPayload, hashPayload, issueToken, verifyToken } from '../src/approval';
import { upsertFact } from '../src/agent/policy/facts';
import { templateDraft } from '../src/agent/writer';
import { newCaseRecord } from '../src/core/store/cases';
import { recoverAfterRestart } from '../src/core/fsm';

function readyCase() {
  const c = newCaseRecord('zh');
  const ocr = (key: string, label: string, value: string) => upsertFact(c, { key, label, value, provenance: 'TICKET_OCR', status: 'NEEDS_CONFIRMATION' });
  ocr('ticketNumber', 'Ticket number', '900000001');
  ocr('plateNumber', 'Plate number', '8KDW21');
  ocr('plateState', 'Registration state', 'MA');
  ocr('issuedAt', 'Issued at', '2026-11-15T14:32:00-05:00');
  ocr('location', 'Location', '700 Commonwealth Ave, Boston');
  ocr('violation', 'Violation', 'METER FEE UNPAID');
  for (const [key, value] of [
    ['fullName', 'Alex Demo'],
    ['mailingAddress', '1 Demo St, Boston, MA 02215'],
    ['email', 'alex@example.com'],
  ])
    upsertFact(c, { key, label: key, value, provenance: 'PROFILE', status: 'CONFIRMED' });
  const rule = upsertFact(c, { key: 'rule:meter_free_day', label: 'Sunday', value: 'Sunday — meters free', provenance: 'RULE', status: 'RULE_VERIFIED' });
  c.draft = templateDraft(c, 'METER_NOT_IN_EFFECT', [{ text: 'Meters are free on Sundays.', factIds: [rule.id] }]);
  return c;
}

describe('approval gate', () => {
  it('OCR facts must be confirmed by the user before approval', () => {
    const c = readyCase();
    const p = approvalPreview(c);
    expect(p.missing).toEqual([]);
    expect(p.unconfirmedFactIds.length).toBeGreaterThan(0);
    for (const f of c.facts) if (f.status === 'NEEDS_CONFIRMATION') f.status = 'CONFIRMED';
    expect(approvalPreview(c).unconfirmedFactIds).toEqual([]);
  });

  it('token verifies only for the exact payload, case and adapter version', () => {
    const c = readyCase();
    const ph = hashPayload(buildApprovalPayload(c));
    const { token } = issueToken('secret', { caseId: c.id, payloadHash: ph, adapterVersion: ADAPTER_VERSION, ttlMs: 60_000 });
    expect(verifyToken('secret', token, { caseId: c.id, payloadHash: ph, adapterVersion: ADAPTER_VERSION }).ok).toBe(true);
    expect(verifyToken('other-secret', token, { caseId: c.id, payloadHash: ph, adapterVersion: ADAPTER_VERSION }).ok).toBe(false);
    expect(verifyToken('secret', token, { caseId: 'case_x', payloadHash: ph, adapterVersion: ADAPTER_VERSION }).ok).toBe(false);
    expect(verifyToken('secret', token, { caseId: c.id, payloadHash: ph, adapterVersion: 'v-next' }).ok).toBe(false);
  });

  it('any change to what will be typed invalidates the approval', () => {
    const c = readyCase();
    const ph = hashPayload(buildApprovalPayload(c));
    const { token } = issueToken('secret', { caseId: c.id, payloadHash: ph, adapterVersion: ADAPTER_VERSION, ttlMs: 60_000 });
    c.facts.find((f) => f.key === 'email')!.value = 'attacker@example.com';
    const after = hashPayload(buildApprovalPayload(c));
    expect(after).not.toBe(ph);
    expect(verifyToken('secret', token, { caseId: c.id, payloadHash: after, adapterVersion: ADAPTER_VERSION })).toMatchObject({
      ok: false,
      reason: 'payload changed since approval',
    });
  });

  it('tampered or expired tokens are rejected', () => {
    const c = readyCase();
    const ph = hashPayload(buildApprovalPayload(c));
    const { token } = issueToken('secret', { caseId: c.id, payloadHash: ph, adapterVersion: ADAPTER_VERSION, ttlMs: -1 });
    expect(verifyToken('secret', token, { caseId: c.id, payloadHash: ph, adapterVersion: ADAPTER_VERSION })).toMatchObject({
      ok: false,
      reason: 'approval expired',
    });
    const [body, sig] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), exp: Date.now() + 1e9 })).toString('base64url')}.${sig}`;
    expect(verifyToken('secret', forged, { caseId: c.id, payloadHash: ph, adapterVersion: ADAPTER_VERSION })).toMatchObject({
      ok: false,
      reason: 'bad signature',
    });
  });

  it('crash recovery never leaves a case mid-submission', () => {
    const a = readyCase();
    a.state = 'SUBMITTING';
    recoverAfterRestart(a);
    expect(a.state).toBe('UNKNOWN_RESULT');
    const b = readyCase();
    b.state = 'FILLING';
    recoverAfterRestart(b);
    expect(b.state).toBe('NEEDS_USER');
    const c = readyCase();
    c.state = 'APPROVED';
    recoverAfterRestart(c);
    expect(c.state).toBe('STATEMENT_REVIEW');
    const d = readyCase();
    d.state = 'DRAFTING';
    recoverAfterRestart(d);
    expect(d.state).toBe('FACTS_REVIEW');
    const e = readyCase();
    e.state = 'STATEMENT_REVIEW';
    expect(recoverAfterRestart(e)).toBeNull();
  });
});
