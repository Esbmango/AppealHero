import type { DisputeReason, PlaybookCtx, Playbook, Ground, RuleResult } from '@appealhero/shared';
import type { CaseRecord } from '../../core/types';
import { RULE_METADATA, runRule } from '../rules/boston';
import { BOSTON_PLAYBOOKS } from './boston';

/** Playbook registry (owner: WP4). The generic playbook must be last: it matches everything. */
export const PLAYBOOKS: readonly Playbook[] = [...BOSTON_PLAYBOOKS];

export function playbookContext(c: CaseRecord): PlaybookCtx {
  const facts = new Map(c.facts.map((f) => [f.key, f]));
  const rules = new Map<string, RuleResult>();
  for (const rule of ['meter_hours_in_effect', 'meter_free_day', 'receipt_covers_ticket'] as const) {
    if (!RULE_METADATA[rule].verified) continue;
    const checked = facts.get('rule:' + rule);
    const issuedAt = facts.get('issuedAt')?.value;
    const paidUntil = facts.get('paidUntil')?.value;
    if (!issuedAt || !Number.isFinite(Date.parse(issuedAt)) || checked?.provenance !== 'RULE' || checked.status !== 'RULE_VERIFIED') continue;
    if (
      rule === 'receipt_covers_ticket' &&
      (!paidUntil || !Number.isFinite(Date.parse(paidUntil)) || (facts.has('paidFrom') && !Number.isFinite(Date.parse(facts.get('paidFrom')!.value))))
    )
      continue;
    const result = runRule(rule, {
      issuedAt,
      paidUntil,
      paidFrom: facts.get('paidFrom')?.value,
      receiptPlate: facts.get('receiptPlate')?.value,
      ticketPlate: facts.get('plateNumber')?.value,
    });
    rules.set(rule, { ...result, result: result.result === true });
  }
  return {
    ticket: c.ticket,
    facts,
    rules,
    evidence: c.evidence,
    vehicles: [],
    answers: Object.fromEntries(c.facts.filter((f) => f.provenance === 'USER_TEXT' || f.provenance === 'USER_VOICE').map((f) => [f.key, f.value])),
  };
}
export function supportedDefense(book: Playbook, context: PlaybookCtx, reason: DisputeReason, grounds: Ground[]) {
  return book.defenses.find(
    (d) =>
      d.reason === reason &&
      (d.basis !== 'rule' || (d.verified && !!d.source)) &&
      d.holds(context) === 'yes' &&
      d.needs.every((key) => context.facts.has(key) && grounds.some((g) => g.factIds.includes(context.facts.get(key)!.id))),
  );
}
export function supportsGrounds(book: Playbook, context: PlaybookCtx, reason: DisputeReason, grounds: Ground[]) {
  return !!supportedDefense(book, context, reason, grounds);
}
export const matchPlaybook = (violation: string): Playbook | undefined => PLAYBOOKS.find((p) => p.match(violation));
