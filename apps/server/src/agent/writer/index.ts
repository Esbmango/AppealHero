import { LANGS, PORTAL_FIELDS, type DisputeReason, type Draft, type DraftParagraph, type Ground, type StatementEditRequest } from '@appealhero/shared';
import { config } from '../../core/config';
import { reportError, say, type Ctx } from '../../core/ctx';
import { transition } from '../../core/fsm';
import type { CaseRecord } from '../../core/types';
import { HttpError } from '../../core/util';
import { approvalPreview } from '../../approval';
import { latestFact, validateGrounds } from '../policy/facts';
import { generateJson } from '../llm';
import { formatBoston } from '../rules/boston';

/**
 * Writer (owner: WP5). WP0 provides the v2 flow around it:
 *   FACTS_REVIEW --user--> DRAFTING --system--> STATEMENT_REVIEW --user (revise)--> DRAFTING …
 * Every agent paragraph cites fact ids; invalid or too-long model output falls back to a template.
 * Any change to the statement changes the approval payload hash, so an old approval can never be reused.
 */
const MAX_LEN = PORTAL_FIELDS.find((f) => f.id === 'statement')?.maxLength ?? 2000;
const join = (ps: DraftParagraph[]) => ps.map((p) => p.text.trim()).join('\n\n');

export async function composeDraft(
  ctx: Ctx,
  caseId: string,
  reason: DisputeReason,
  grounds: Ground[],
  opts: { instructions?: string[]; revision?: number } = {},
): Promise<Draft> {
  const c = ctx.store.must(caseId);
  const revision = opts.revision ?? 1;
  if (config.aiMode === 'gemini') {
    try {
      const facts = c.facts.map((f) => `${f.id}: ${f.label} = ${f.note ?? f.value} [${f.status}]`).join('\n');
      const out = await generateJson<{ paragraphs: Ground[]; translation: string }>(
        ctx,
        caseId,
        [
          {
            text: [
              'Write a formal, concise English appeal statement to the City of Boston Office of the Parking Clerk.',
              `Use ONLY these facts (id: label = value [status]):\n${facts}`,
              `Grounds to argue:\n${grounds.map((g) => `- ${g.text} (facts: ${g.factIds.join(', ')})`).join('\n')}`,
              ...(opts.instructions?.length
                ? [`The user asked for these changes (apply them without adding unlisted facts):\n${opts.instructions.map((i) => `- ${i}`).join('\n')}`]
                : []),
              `3–5 short paragraphs, at most ${MAX_LEN - 300} characters in total. First paragraph identifies the ticket. No legal threats, no promises, no facts that are not listed.`,
              'Every paragraph must list the fact ids it relies on in factIds.',
              `Also return a faithful translation of the whole statement into ${LANGS[c.lang as keyof typeof LANGS] ?? c.lang} in "translation" (for the user to review — it is not submitted).`,
            ].join('\n\n'),
          },
        ],
        {
          type: 'object',
          properties: {
            paragraphs: {
              type: 'array',
              items: {
                type: 'object',
                properties: { text: { type: 'string' }, factIds: { type: 'array', items: { type: 'string' } } },
                required: ['text', 'factIds'],
              },
            },
            translation: { type: 'string' },
          },
          required: ['paragraphs', 'translation'],
        },
        'You draft factual, grounded appeal statements. Output JSON only.',
      );
      const paragraphs: DraftParagraph[] = out.paragraphs.map((p) => ({ ...p, author: 'agent' }));
      const statement = join(paragraphs);
      if (!validateGrounds(paragraphs, c.facts).length && statement.length <= MAX_LEN) {
        return { disputeReason: reason, paragraphs, statementEn: statement, statementUserLang: out.translation || statement, lang: c.lang, revision };
      }
    } catch (err) {
      ctx.hub.emit({ type: 'error', caseId, message: `draft model failed, using template: ${(err as Error).message}` });
    }
  }
  return templateDraft(c, reason, grounds, revision);
}

export function templateDraft(c: CaseRecord, reason: DisputeReason, grounds: Ground[], revision = 1): Draft {
  const t = latestFact(c, 'ticketNumber');
  const issued = latestFact(c, 'issuedAt');
  const loc = latestFact(c, 'location');
  const viol = latestFact(c, 'violation');
  const introIds = [t, issued, loc, viol].filter(Boolean).map((f) => f!.id);
  const intro: DraftParagraph = {
    text: `I am writing to appeal parking ticket ${t?.value ?? ''}, issued on ${issued ? formatBoston(issued.value) : 'the date shown on the ticket'} at ${loc?.value ?? 'the location shown on the ticket'} for "${viol?.value ?? 'the listed violation'}".`,
    factIds: introIds.length ? introIds : (grounds[0]?.factIds ?? []),
    author: 'agent',
  };
  const closing: DraftParagraph = {
    text: 'I respectfully request that this ticket be dismissed. The supporting evidence is attached for your review.',
    factIds: t ? [t.id] : (grounds[0]?.factIds ?? []),
    author: 'agent',
  };
  const paragraphs: DraftParagraph[] = [intro, ...grounds.map((g) => ({ ...g, author: 'agent' as const })), closing];
  let statementEn = join(paragraphs);
  if (statementEn.length > MAX_LEN) statementEn = statementEn.slice(0, MAX_LEN - 1);
  return { disputeReason: reason, paragraphs, statementEn, statementUserLang: userLangSummary(c, reason, t?.value ?? ''), lang: c.lang, revision };
}

const ZH_REASON: Record<DisputeReason, string> = {
  METER_NOT_IN_EFFECT:
    '罚单开具时是周日或市政假日（或不在计时器运营时间内）。根据 boston.gov，计时器周一至周六 8:00–20:00 运营，周日和全市假日免费，因此当时不需要缴费。',
  PAID: '我当时已经付了停车费，付款记录显示的有效时间覆盖了罚单开具时间。',
  SIGNAGE: '现场路牌缺失、被遮挡或不适用，照片证据已附上。',
  VEHICLE_INFO: '罚单上的车辆或车牌信息与我的车辆不符。',
  PERMIT_DISPLAYED: '我当时在车上展示了该街区有效的居民停车许可，照片证据已附上。',
  OTHER: '具体情况见我本人的陈述。',
};
const ES_REASON: Record<DisputeReason, string> = {
  METER_NOT_IN_EFFECT:
    'La multa se emitió en domingo o día festivo de la ciudad (o fuera del horario de los parquímetros). Según boston.gov, los parquímetros funcionan de lunes a sábado de 8:00 a 20:00 y son gratuitos los domingos y festivos, así que no se debía pagar.',
  PAID: 'Pagué el estacionamiento y el recibo cubre la hora en que se emitió la multa.',
  SIGNAGE: 'La señal faltaba, estaba tapada o no correspondía; adjunto foto.',
  VEHICLE_INFO: 'Los datos del vehículo o de la placa en la multa no coinciden con mi vehículo.',
  PERMIT_DISPLAYED: 'Tenía a la vista un permiso de residente válido para esa zona; adjunto foto.',
  OTHER: 'Los detalles están en mi propia declaración.',
};

function userLangSummary(c: CaseRecord, reason: DisputeReason, ticket: string): string {
  if (c.lang === 'zh') return `（中文对照，仅供你核对；提交的是英文原文）\n我对罚单 ${ticket} 提出申诉。\n${ZH_REASON[reason]}\n恳请撤销该罚单，证据已附上。`;
  if (c.lang === 'es')
    return `(Traducción solo para que la revises; se envía el texto en inglés)\nApelo la multa ${ticket}.\n${ES_REASON[reason]}\nSolicito respetuosamente que se anule la multa; adjunto la evidencia.`;
  return '';
}

/** What to argue: the agent's proposal (stored when it moved the case to FACTS_REVIEW), or the user's own statement. */
function plan(c: CaseRecord): { reason: DisputeReason; grounds: Ground[] } {
  if (c.triage?.recommendation === 'APPEAL' && c.triage.reasons.length) return { reason: c.triage.disputeReason ?? 'OTHER', grounds: c.triage.reasons };
  const account = latestFact(c, 'userAccount');
  return { reason: 'OTHER', grounds: account ? [{ text: `In my own words: ${account.note ?? account.value}`, factIds: [account.id] }] : [] };
}

function publishReview(ctx: Ctx, caseId: string) {
  ctx.hub.emit({ type: 'review.ready', caseId, preview: approvalPreview(ctx.store.must(caseId)) });
}

/** DRAFTING → STATEMENT_REVIEW (or back to FACTS_REVIEW if the writer fails). */
export async function writeStatement(ctx: Ctx, caseId: string, instructions?: string[]) {
  try {
    const c = ctx.store.must(caseId);
    const { reason, grounds } = plan(c);
    if (!grounds.length) throw new Error('nothing to argue yet — tell me in your own words why you are appealing');
    const draft = await composeDraft(ctx, caseId, reason, grounds, { instructions, revision: (c.draft?.revision ?? 0) + 1 });
    transition(ctx, caseId, 'STATEMENT_REVIEW', 'system', `statement revision ${draft.revision} ready`, (r) => {
      r.draft = draft;
    });
    publishReview(ctx, caseId);
  } catch (err) {
    reportError(ctx, caseId, err);
    if (ctx.store.get(caseId)?.state === 'DRAFTING') transition(ctx, caseId, 'FACTS_REVIEW', 'system', `writer failed: ${(err as Error).message}`);
  }
}

/** A chat message during STATEMENT_REVIEW is a revision request. WP5 replaces this with a real reviser
 *  (new facts in the instruction → USER_STATEMENT, keep user-written paragraphs). */
export async function reviseStatement(ctx: Ctx, caseId: string, instruction: string) {
  transition(ctx, caseId, 'DRAFTING', 'user', `user asked for a revision: ${instruction.slice(0, 80)}`);
  const lang = ctx.store.must(caseId).lang;
  say(ctx, caseId, lang === 'zh' ? '好的，我按你的要求修改申诉信。' : lang === 'es' ? 'De acuerdo, voy a revisar la carta.' : 'OK — revising the statement.');
  await writeStatement(ctx, caseId, [instruction]);
}

/** PUT /api/cases/:id/statement — the user edits paragraphs directly. Unchanged paragraphs keep their citations. */
export function applyUserEdit(ctx: Ctx, caseId: string, edit: StatementEditRequest): Draft {
  const c = ctx.store.must(caseId);
  if (c.state !== 'STATEMENT_REVIEW' || !c.draft) throw new HttpError(409, `the statement can only be edited during STATEMENT_REVIEW (now ${c.state})`);
  const before = new Map(c.draft.paragraphs.map((p) => [p.text.trim(), p]));
  const paragraphs: DraftParagraph[] = edit.paragraphs.map((p) => before.get(p.text.trim()) ?? { text: p.text.trim(), factIds: p.factIds, author: 'user' });
  const errors = validateGrounds(paragraphs, c.facts);
  const statementEn = join(paragraphs);
  if (statementEn.length > MAX_LEN) errors.push(`the statement is longer than ${MAX_LEN} characters`);
  if (errors.length) throw new HttpError(422, 'invalid statement', { missing: errors });
  const changed = paragraphs.some((p) => p.author === 'user' && !before.has(p.text));
  const note =
    c.lang === 'zh' ? '（你修改了英文正文；对照译文尚未更新）\n' : c.lang === 'es' ? '(Editaste el texto en inglés; la traducción no se ha actualizado)\n' : '';
  const draft: Draft = {
    ...c.draft,
    paragraphs,
    statementEn,
    statementUserLang:
      changed && c.draft.statementUserLang && !c.draft.statementUserLang.startsWith(note) ? note + c.draft.statementUserLang : c.draft.statementUserLang,
    revision: c.draft.revision + 1,
  };
  ctx.store.mutate(caseId, (r) => {
    r.draft = draft;
    r.approval = undefined;
  });
  publishReview(ctx, caseId);
  return draft;
}
