import { z } from 'zod';
import { defineTool, type ToolResult } from '@appealhero/shared';
import type { ToolCtx } from './types';
import { DISPUTE_REASON_KEYS, type DisputeReason, type Ground, type Triage } from '@appealhero/shared';
import { say, type Ctx } from '../../core/ctx';
import { transition } from '../../core/fsm';
import { isObj, str } from '../../core/util';
import { latestFact, pendingFactIds, validateGrounds } from '../policy/facts';
import { matchPlaybook, playbookContext, supportsGrounds } from '../playbooks';
import { fineFor, runRule } from '../rules/boston';

const params = z.object({
  recommendation: z.enum(['APPEAL', 'PAY']),
  dispute_reason: z.enum(DISPUTE_REASON_KEYS).optional(),
  summary_user_lang: z.string().describe('short explanation for the user, in their language'),
  grounds: z.array(z.object({ text_en: z.string(), fact_ids: z.array(z.string()) })),
});

export const proposeOutcomeTool = defineTool<ToolCtx, typeof params>({
  name: 'propose_outcome',
  description:
    'Finish the investigation. recommendation=PAY when there is no lawful ground (say so honestly, with fine, late penalty and deadline). recommendation=APPEAL needs dispute_reason and grounds that cite fact ids; the user then confirms every fact before the statement is written.',
  stages: ['INVESTIGATING'],
  params,
  run: (t, a) => proposeOutcome(t.ctx, t.caseId, a),
});

async function proposeOutcome(ctx: Ctx, caseId: string, a: Record<string, unknown>): Promise<ToolResult> {
  const c = ctx.store.must(caseId);
  const recommendation = a.recommendation === 'PAY' ? 'PAY' : 'APPEAL';
  const grounds: Ground[] = (Array.isArray(a.grounds) ? a.grounds : [])
    .filter(isObj)
    .map((g) => ({ text: str(g.text_en ?? g.text), factIds: (Array.isArray(g.fact_ids) ? g.fact_ids : []).map(String) }))
    .filter((g) => g.text);
  const errors = validateGrounds(grounds, c.facts);
  if (errors.length) return { result: { error: 'invalid grounds', details: errors }, isError: true };
  const summary = str(a.summary_user_lang);

  if (recommendation === 'PAY') {
    const f = fineFor(latestFact(c, 'violation')?.value, Number(latestFact(c, 'fineAmount')?.value) || undefined, c.violationType);
    const issued = latestFact(c, 'issuedAt')?.value;
    const deadline = issued ? runRule('appeal_deadline', { issuedAt: issued }) : null;
    const triage: Triage = {
      recommendation: 'PAY',
      summary,
      reasons: grounds,
      fineAmount: f.fine,
      latePenalty: f.late,
      deadline: typeof deadline?.result === 'string' ? deadline.result : undefined,
    };
    ctx.store.mutate(caseId, (r) => {
      r.triage = triage;
      r.pendingQuestion = undefined;
    });
    ctx.hub.emit({ type: 'triage', caseId, triage });
    if (summary) say(ctx, caseId, summary);
    return { result: { status: 'recommendation shown — the user decides (accept_pay or appeal_anyway)' }, endTurn: true };
  }

  if (!grounds.length) return { result: { error: 'APPEAL needs at least one ground that cites fact ids' }, isError: true };
  const missingContact = (['fullName', 'mailingAddress', 'email'] as const).filter((k) => !latestFact(c, k)?.value);
  if (missingContact.length)
    return { result: { error: `missing appellant details: ${missingContact.join(', ')} — ask the user with ask_user, then record_fact` }, isError: true };
  const reason = (DISPUTE_REASON_KEYS as readonly string[]).includes(str(a.dispute_reason)) ? (str(a.dispute_reason) as DisputeReason) : 'OTHER';
  // Honest triage (review P1.2): OTHER is the user's own story, never a ground the model invents. It is allowed only
  // after the user explicitly chose "appeal anyway", or for ticket types without a playbook — and must cite what the user said.
  if (reason === 'OTHER') {
    if (!c.appealAnyway && c.violationType && c.violationType !== 'OTHER')
      return {
        result: { error: 'OTHER is only allowed after the user explicitly chooses to appeal anyway — use a supported ground or recommend PAY' },
        isError: true,
      };
    const userFacts = new Set(c.facts.filter((f) => f.provenance === 'USER_TEXT' || f.provenance === 'USER_VOICE').map((f) => f.id));
    if (!grounds.some((g) => g.factIds.some((id) => userFacts.has(id))))
      return { result: { error: "an OTHER appeal must cite the user's own statement" }, isError: true };
  }
  // Ticket types with a playbook must match one of its defenses. Types without one yet (street cleaning, no stopping)
  // keep the grounds checks above until a generic playbook exists, so a wrong-plate appeal is not silently blocked.
  const book = matchPlaybook(c.ticket?.violation ?? c.violationType ?? '');
  if (reason !== 'OTHER' && book && !supportsGrounds(book, playbookContext(c), reason, grounds))
    return { result: { error: 'This appeal reason is unsupported by the cited evidence and verified rules for this ticket.' }, isError: true };
  // v2: the agent only PROPOSES. The user confirms every fact (gate 1) before anything is written.
  ctx.store.mutate(caseId, (r) => {
    r.triage = { recommendation: 'APPEAL', summary, reasons: grounds, disputeReason: reason };
    r.draft = undefined;
    r.approval = undefined;
    r.pendingQuestion = undefined;
  });
  if (ctx.store.must(caseId).state === 'INVESTIGATING')
    transition(ctx, caseId, 'FACTS_REVIEW', 'agent', `agent proposed APPEAL (${reason}) — waiting for the user to confirm the facts`);
  const after = ctx.store.must(caseId);
  ctx.hub.emit({ type: 'facts.review', caseId, facts: after.facts, pendingFactIds: pendingFactIds(after) });
  if (summary) say(ctx, caseId, summary);
  return { result: { status: 'proposal shown — the user is confirming the facts; the statement is written after that' }, endTurn: true };
}
