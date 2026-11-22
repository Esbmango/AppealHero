import { z } from 'zod';
import { defineTool, type ToolResult } from '@appealhero/shared';
import type { ToolCtx } from './types';
import { DISPUTE_REASON_KEYS, type DisputeReason, type Ground, type Triage } from '@appealhero/shared';
import { say, type Ctx } from '../../core/ctx';
import { transition } from '../../core/fsm';
import { isObj, str } from '../../core/util';
import { latestFact, pendingFactIds, validateGrounds } from '../policy/facts';
import { matchPlaybook, playbookContext, supportedDefense, supportsGrounds } from '../playbooks';
import { assess } from '../playbooks/boston/assessment';
import { personalFacts } from '../runtime/circumstances';

const params = z.object({
  recommendation: z.enum(['APPEAL', 'PAY']),
  dispute_reason: z.enum(DISPUTE_REASON_KEYS).optional(),
  summary_user_lang: z.string().describe('short explanation for the user, in their language'),
  grounds: z.array(z.object({ text_en: z.string(), fact_ids: z.array(z.string()) })),
});

export const proposeOutcomeTool = defineTool<ToolCtx, typeof params>({
  name: 'propose_outcome',
  description:
    'Finish the investigation. Propose a supported appeal or a discretionary OTHER request grounded in the driver’s own circumstances. Recommend PAY when neither applies. Cite fact ids. The user confirms every fact before drafting.',
  stages: ['INVESTIGATING'],
  params,
  run: (t, a) => proposeOutcome(t.ctx, t.caseId, a),
});

async function proposeOutcome(ctx: Ctx, caseId: string, a: Record<string, unknown>): Promise<ToolResult> {
  const c = ctx.store.must(caseId);
  let recommendation: Triage['recommendation'] = a.recommendation === 'PAY' ? 'PAY' : 'APPEAL';
  let grounds: Ground[] = (Array.isArray(a.grounds) ? a.grounds : [])
    .filter(isObj)
    .map((g) => ({ text: str(g.text_en ?? g.text), factIds: (Array.isArray(g.fact_ids) ? g.fact_ids : []).map(String) }))
    .filter((g) => g.text);
  const errors = validateGrounds(grounds, c.facts);
  if (errors.length) return { result: { error: 'invalid grounds', details: errors }, isError: true };
  let summary = str(a.summary_user_lang);
  const personal = personalFacts(c);
  let reason = (DISPUTE_REASON_KEYS as readonly string[]).includes(str(a.dispute_reason)) ? (str(a.dispute_reason) as DisputeReason) : 'OTHER';
  const book = matchPlaybook(c.ticket?.violation || c.violationType || '');
  if (personal.length && (recommendation === 'PAY' || reason === 'OTHER')) {
    recommendation = 'APPEAL';
    const context = playbookContext(c);
    const proven = book?.defenses.find(
      (d) =>
        d.reason !== 'OTHER' && (d.basis !== 'rule' || (d.verified && d.source)) && d.holds(context) === 'yes' && d.needs.every((k) => context.facts.has(k)),
    );
    if (proven) {
      reason = proven.reason;
      grounds = [{ text: proven.explain.en, factIds: proven.needs.map((k) => context.facts.get(k)!.id) }];
      summary = proven.explain[c.lang === 'zh' || c.lang === 'es' ? c.lang : 'en'];
    } else reason = 'OTHER';
  }
  const documentedDuplicate = reason === 'OTHER' && book && supportedDefense(book, playbookContext(c), reason, grounds)?.id === 'duplicate_notice';
  if (documentedDuplicate) {
    const notice = latestFact(c, 'duplicateNotice')!;
    const report = latestFact(c, 'duplicateReport')!;
    grounds = [
      {
        text: 'I reported two notices for the same parking incident. Please compare this ticket with notice ' + notice.value + '.',
        factIds: [report.id, notice.id],
      },
    ];
  }
  if (recommendation === 'APPEAL' && reason === 'OTHER' && personal.length && !documentedDuplicate) {
    grounds = personal.map((f) => ({ text: f.note ?? f.value, factIds: [f.id] }));
    summary = assess(c, recommendation, reason, grounds).strengthWhy;
  }

  if (recommendation === 'PAY') {
    const triage: Triage = { recommendation, summary, reasons: grounds, ...assess(c, recommendation, undefined, grounds) };
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
  // Honest triage (review P1.2): OTHER is the user's own story, never a ground the model invents. It is allowed only
  // for documented duplicates, personal circumstances, an explicit appeal-anyway choice or a ticket without a playbook.
  if (reason === 'OTHER') {
    if (!documentedDuplicate && !personal.length && !c.appealAnyway && c.violationType && c.violationType !== 'OTHER')
      return {
        result: { error: 'OTHER is only allowed after the user explicitly chooses to appeal anyway — use a supported ground or recommend PAY' },
        isError: true,
      };
    const userFacts = new Set(c.facts.filter((f) => f.provenance === 'USER_TEXT' || f.provenance === 'USER_VOICE').map((f) => f.id));
    if (!grounds.some((g) => g.factIds.some((id) => userFacts.has(id))))
      return { result: { error: "an OTHER appeal must cite the user's own statement" }, isError: true };
  }
  // Specific reasons must satisfy the matching playbook and cite its supporting facts.
  if (reason !== 'OTHER' && book && !supportsGrounds(book, playbookContext(c), reason, grounds))
    return { result: { error: 'This appeal reason is unsupported by the cited evidence and verified rules for this ticket.' }, isError: true };
  // v2: the agent only PROPOSES. The user confirms every fact (gate 1) before anything is written.
  ctx.store.mutate(caseId, (r) => {
    r.triage = { recommendation: 'APPEAL', summary, reasons: grounds, disputeReason: reason, ...assess(c, recommendation, reason, grounds) };
    r.draft = undefined;
    r.approval = undefined;
    r.pendingQuestion = undefined;
  });
  if (ctx.store.must(caseId).state === 'INVESTIGATING')
    transition(ctx, caseId, 'FACTS_REVIEW', 'agent', `agent proposed APPEAL (${reason}) — waiting for the user to confirm the facts`);
  const after = ctx.store.must(caseId);
  ctx.hub.emit({ type: 'triage', caseId, triage: after.triage! });
  ctx.hub.emit({ type: 'facts.review', caseId, facts: after.facts, pendingFactIds: pendingFactIds(after) });
  if (summary) say(ctx, caseId, summary);
  return { result: { status: 'proposal shown — the user is confirming the facts; the statement is written after that' }, endTurn: true };
}
