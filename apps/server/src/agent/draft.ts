import { LANGS, PORTAL_FIELDS, type DisputeReason, type Draft, type Ground } from '@appealhero/shared';
import { config } from '../config';
import type { Ctx } from '../ctx';
import type { CaseRecord } from '../types';
import { latestFact, validateGrounds } from './facts';
import { generateJson } from './llm';
import { formatBoston } from './rules';

const MAX_LEN = PORTAL_FIELDS.find((f) => f.id === 'statement')?.maxLength ?? 2000;
const join = (ps: Ground[]) => ps.map((p) => p.text.trim()).join('\n\n');

/** Grounded drafting: every paragraph cites fact ids; invalid or too-long model output falls back to a template. */
export async function composeDraft(ctx: Ctx, caseId: string, reason: DisputeReason, grounds: Ground[]): Promise<Draft> {
  const c = ctx.store.must(caseId);
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
              items: { type: 'object', properties: { text: { type: 'string' }, factIds: { type: 'array', items: { type: 'string' } } }, required: ['text', 'factIds'] },
            },
            translation: { type: 'string' },
          },
          required: ['paragraphs', 'translation'],
        },
        'You draft factual, grounded appeal statements. Output JSON only.',
      );
      const statement = join(out.paragraphs);
      if (!validateGrounds(out.paragraphs, c.facts).length && statement.length <= MAX_LEN) {
        return { disputeReason: reason, paragraphs: out.paragraphs, statementEn: statement, statementUserLang: out.translation || statement, lang: c.lang };
      }
    } catch (err) {
      ctx.hub.emit({ type: 'error', caseId, message: `draft model failed, using template: ${(err as Error).message}` });
    }
  }
  return templateDraft(c, reason, grounds);
}

export function templateDraft(c: CaseRecord, reason: DisputeReason, grounds: Ground[]): Draft {
  const t = latestFact(c, 'ticketNumber');
  const issued = latestFact(c, 'issuedAt');
  const loc = latestFact(c, 'location');
  const viol = latestFact(c, 'violation');
  const introIds = [t, issued, loc, viol].filter(Boolean).map((f) => f!.id);
  const intro: Ground = {
    text: `I am writing to appeal parking ticket ${t?.value ?? ''}, issued on ${issued ? formatBoston(issued.value) : 'the date shown on the ticket'} at ${loc?.value ?? 'the location shown on the ticket'} for "${viol?.value ?? 'the listed violation'}".`,
    factIds: introIds.length ? introIds : grounds[0]?.factIds ?? [],
  };
  const closing: Ground = {
    text: 'I respectfully request that this ticket be dismissed. The supporting evidence is attached for your review.',
    factIds: t ? [t.id] : grounds[0]?.factIds ?? [],
  };
  const paragraphs = [intro, ...grounds, closing];
  let statementEn = join(paragraphs);
  if (statementEn.length > MAX_LEN) statementEn = statementEn.slice(0, MAX_LEN - 1);
  return { disputeReason: reason, paragraphs, statementEn, statementUserLang: userLangSummary(c, reason, t?.value ?? ''), lang: c.lang };
}

const ZH_REASON: Record<DisputeReason, string> = {
  METER_NOT_IN_EFFECT: '罚单开具时是周日或市政假日（或不在计时器运营时间内）。根据 boston.gov，计时器周一至周六 8:00–20:00 运营，周日和全市假日免费，因此当时不需要缴费。',
  PAID: '我当时已经付了停车费，付款记录显示的有效时间覆盖了罚单开具时间。',
  SIGNAGE: '现场路牌缺失、被遮挡或不适用，照片证据已附上。',
  VEHICLE_INFO: '罚单上的车辆或车牌信息与我的车辆不符。',
  OTHER: '具体情况见我本人的陈述。',
};

function userLangSummary(c: CaseRecord, reason: DisputeReason, ticket: string): string {
  if (c.lang !== 'zh') return '';
  return `（中文对照，仅供你核对；提交的是英文原文）\n我对罚单 ${ticket} 提出申诉。\n${ZH_REASON[reason]}\n恳请撤销该罚单，证据已附上。`;
}
