/**
 * WP4 playbooks, rules & fake driver — acceptance tests from docs/TASKS.md (WP4).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import type { Playbook, TicketInfo } from '@appealhero/shared';
import { DEMO_TICKETS } from '@appealhero/shared';
import { RULE_NAMES, RULE_METADATA } from '../src/agent/rules/boston';
import { newCaseRecord } from '../src/core/store/cases';
import { upsertFact } from '../src/agent/policy/facts';
import { matchPlaybook, playbookContext, supportsGrounds } from '../src/agent/playbooks';
import { buildSystemPrompt } from '../src/agent/context';
import { describe, expect, it } from 'vitest';

function example(key: 'meter' | 'meterWeekday' | 'permit' | 'hydrant', values: Record<string, string> = {}) {
  const t = DEMO_TICKETS[key];
  const c = newCaseRecord('es');
  c.ticket = {
    ticketNumber: t.ticketNumber,
    plate: t.plateNumber,
    state: t.plateState,
    violation: t.violationDescription,
    issuedAt: t.issuedAt,
    location: t.location,
    source: 'TICKET_OCR',
  } satisfies TicketInfo;
  for (const [key, value] of Object.entries({ issuedAt: t.issuedAt, plateNumber: t.plateNumber, ...values })) {
    const rule = key.startsWith('rule:');
    upsertFact(c, { key, label: key, value, status: rule ? 'RULE_VERIFIED' : 'NEEDS_CONFIRMATION', provenance: rule ? 'RULE' : 'PHOTO_EVIDENCE' });
  }
  const book = matchPlaybook(t.violationDescription)!;
  const ctx = playbookContext(c);
  const grounds = [{ text: 'synthetic evidence', factIds: c.facts.map((f) => f.id) }];
  return { book, c, ctx, grounds, accepts: (reason: Parameters<typeof supportsGrounds>[2]) => supportsGrounds(book, ctx, reason, grounds) };
}
describe('WP4 playbooks, rules & fake driver', () => {
  it('wp4: violations map to the right playbook and unknown ones to generic', () => {
    expect(
      Object.values(DEMO_TICKETS)
        .slice(0, 3)
        .map((t) => matchPlaybook(t.violationDescription)?.id),
    ).toEqual(['boston.meter', 'boston.resident_permit', 'boston.hydrant']);
    expect(matchPlaybook('something else')).toBeUndefined();
    const { c } = example('meterWeekday');
    expect(buildSystemPrompt(c)).toContain('¿Cómo pagaste');
  });
  it('wp4: every rule has a source, checkedAt and verified flag', () => {
    for (const rule of RULE_NAMES) {
      expect(RULE_METADATA[rule].source).toBeTruthy();
      expect(RULE_METADATA[rule].checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof RULE_METADATA[rule].verified).toBe('boolean');
    }
  });
  it('wp4: unverified rules never produce grounds', () => {
    const { book, ctx, grounds, accepts } = example('meter', { 'rule:meter_hours_in_effect': 'checked' });
    expect(accepts('METER_NOT_IN_EFFECT')).toBe(true);
    const unchecked: Playbook = { ...book, defenses: book.defenses.map((d) => ({ ...d, verified: false })) };
    expect(supportsGrounds(unchecked, ctx, 'METER_NOT_IN_EFFECT', grounds)).toBe(false);
    expect(supportsGrounds(book, ctx, 'METER_NOT_IN_EFFECT', [{ text: 'irrelevant citation', factIds: [] }])).toBe(false);
  });
  it('wp4: ideal paths ask at most 3 questions', () => {
    for (const key of ['meter', 'permit', 'hydrant'] as const) {
      const { book, ctx } = example(key);
      expect(book.questions.filter((q) => q.askIf(ctx)).length).toBeLessThanOrEqual(3);
    }
    const sunday = example('meter', { 'rule:meter_hours_in_effect': 'checked' });
    expect(sunday.book.questions.filter((q) => q.askIf(sunday.ctx))).toHaveLength(0);
  });
  it('meter: receipt coverage, unpaid time, broken meter and holiday', () => {
    expect(example('meterWeekday', { paidUntil: '2026-11-17T10:30:00-05:00', 'rule:receipt_covers_ticket': 'checked' }).accepts('PAID')).toBe(true);
    expect(example('meterWeekday', { paidUntil: '2026-11-17T09:50:00-05:00', 'rule:receipt_covers_ticket': 'checked' }).accepts('PAID')).toBe(false);
    expect(example('meterWeekday', { payment: 'broken' }).accepts('METER_NOT_IN_EFFECT')).toBe(false);
    expect(example('meterWeekday', { issuedAt: '2026-11-26T10:05:00-05:00', 'rule:meter_hours_in_effect': 'checked' }).accepts('METER_NOT_IN_EFFECT')).toBe(
      true,
    );
  });
  it('permit: readable versus obscured sign and matching versus wrong neighborhood', () => {
    const evidence = { permitArea: 'Back Bay', signArea: 'Back Bay', permitPlate: 'KDT4821', permitDisplayed: 'yes' };
    expect(example('permit', evidence).accepts('PERMIT_DISPLAYED')).toBe(true);
    expect(example('permit', { ...evidence, signArea: 'Fenway' }).accepts('PERMIT_DISPLAYED')).toBe(false);
    for (const [visibility, valid] of [
      ['clear', false],
      ['partially_obscured', true],
    ] as const)
      expect(example('permit', { signVisibility: visibility, signText: 'resident only' }).accepts('SIGNAGE')).toBe(valid);
  });
  it('hydrant: correct vehicle, wrong plate, and distance alone', () => {
    expect(example('hydrant', { vehicleMatches: 'yes' }).accepts('VEHICLE_INFO')).toBe(false);
    expect(example('hydrant', { vehicleMatches: 'No — different plate' }).accepts('VEHICLE_INFO')).toBe(true);
    const sam = example('hydrant', { distance: 'over_10_ft' });
    expect(sam.accepts('OTHER')).toBe(false);
    expect(example('hydrant', { distance: 'over_10_ft', hydrantPhoto: 'Both visible' }).accepts('OTHER')).toBe(true);
    expect(sam.book.recommendPay(sam.ctx)?.fine).toBe(100);
  });
  it('uses printed weekly hours, including overnight restrictions, only with photographed evidence', () => {
    const schedule = { signText: 'Resident only Mon 22:00–06:00', signDays: 'Mon', signStart: '22:00', signEnd: '06:00' };
    expect(example('permit', { ...schedule, issuedAt: '2026-11-17T04:00:00-05:00' }).accepts('SIGNAGE')).toBe(false);
    expect(example('permit', { ...schedule, issuedAt: '2026-11-17T10:00:00-05:00' }).accepts('SIGNAGE')).toBe(true);
    expect(example('permit', { ...schedule, signDays: 'unknown' }).accepts('SIGNAGE')).toBe(false);
  });
  it('compares plates and neighborhoods regardless of spacing, dashes and case', () => {
    const paid = { paidUntil: '2026-11-17T10:30:00-05:00', 'rule:receipt_covers_ticket': 'checked' };
    for (const plate of ['KDT 4821', 'kdt-4821']) expect(example('meterWeekday', { ...paid, receiptPlate: plate }).accepts('PAID')).toBe(true);
    expect(example('meterWeekday', { ...paid, receiptPlate: 'KDT 4822' }).accepts('PAID')).toBe(false);
    const permit = { permitArea: 'BACK-BAY', signArea: 'Back Bay', permitPlate: 'kdt 4821', permitDisplayed: 'yes' };
    expect(example('permit', permit).accepts('PERMIT_DISPLAYED')).toBe(true);
    expect(example('permit', { ...permit, permitPlate: 'KDT 4822' }).accepts('PERMIT_DISPLAYED')).toBe(false);
  });
  it('every playbook accepts a reported vehicle mismatch', () => {
    for (const key of ['meterWeekday', 'permit', 'hydrant'] as const) {
      expect(example(key, { vehicleMatches: 'No — different plate' }).accepts('VEHICLE_INFO')).toBe(true);
      expect(example(key, { vehicleMatches: 'yes' }).accepts('VEHICLE_INFO')).toBe(false);
    }
  });
  it.todo('wp4: every golden test listed in PLAYBOOKS.md passes');
});
