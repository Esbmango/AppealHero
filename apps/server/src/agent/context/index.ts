import { evidenceChecklist } from '../playbooks/boston/assessment';
import { matchPlaybook, playbookContext } from '../playbooks';
import { LANGS, type Playbook, type PlaybookLang } from '@appealhero/shared';
import type { CaseRecord } from '../../core/types';

/**
 * Context builder (owner: WP2). Rebuilt every turn by code: role & limits → language → facts → evidence.
 * WP2 adds: account profile + vehicles, the matched playbook rendered as text (renderPlaybook), rule results.
 */
export function renderPlaybook(book: Playbook, c: CaseRecord, lang: PlaybookLang) {
  const context = playbookContext(c);
  const pay = book.recommendPay(context);
  return [
    book.id,
    'Check these rules: ' + book.autoRules.join(', '),
    ...book.questions.filter((q) => q.askIf(context)).map((q) => q.text[lang] + ' ' + q.why[lang] + ' (record ' + q.records + ')'),
    ...book.defenses
      .filter((d) => d.basis !== 'rule' || d.verified)
      .map((d) => d.reason + ': ' + d.explain[lang] + ' Cite: ' + d.needs.join(', ') + '. ' + d.draftHint + (d.source ? ' ' + d.source : '')),
    ...(book.notes?.filter((n) => n.when(context)).map((n) => n.text[lang]) ?? []),
    pay ? 'If no ground holds: ' + pay.why[lang] + ' Fine $' + pay.fine + ', late fee $' + pay.late + ', deadline ' + pay.deadline : '',
  ]
    .filter(Boolean)
    .join('\n');
}
export function buildSystemPrompt(c: CaseRecord): string {
  const book = matchPlaybook(c.ticket?.violation ?? '');
  const facts = c.facts.map((f) => `${f.id} | ${f.key} | ${f.label} = ${f.note ?? f.value} | ${f.provenance} | ${f.status}`).join('\n');
  const photos =
    c.evidence
      .filter((e) => e.kind !== 'audio')
      .map((e) => `${e.id} (${e.kind})`)
      .join(', ') || 'none';
  return [
    'You are AppealHero. You help a person decide whether and how to appeal a City of Boston parking ticket, then prepare the appeal for THEIR approval. You are not a lawyer and never promise outcomes.',
    `Talk to the user in ${LANGS[c.lang as keyof typeof LANGS] ?? c.lang}. 1–3 short sentences. Ask exactly ONE question at a time with ask_user, and only for information that is actually missing.`,
    'Grounding: meter hours, holidays, fines and deadlines come ONLY from check_rule. Photo findings come ONLY from analyze_evidence. What the user says is recorded with record_fact. Never state a fact you did not get from a tool or the fact list.',
    'Check in order: incorrect ticket/vehicle details; evidence the violation did not occur; specific procedural discrepancies; then personal circumstances. Ask only missing, relevant details of arrival/departure, exact spot, what signs were visible, payment or permit, and unusual events. Offer evidence with its purpose. Never assert a procedural rule without verified support.',
    'The optional personal-circumstances question is offered at intake. Never delay a clear Sunday-meter ground to repeat it. Record volunteered facts from chat or voice under hardship, firstVisit, outOfState or circumstance using the original user wording. Never infer one from a name, plate or persona. For a visitor first probe for unclear signs, unmarked restrictions or a payment app failure. A circumstance alone supports APPEAL/OTHER as a request for discretion; NONE/PAY only if no ground or circumstance exists. Never supply percentages or promise a discount.',
    "To APPEAL you need a dispute_reason, grounds citing fact ids, and the appellant's full name, mailing address and email (ask, then record_fact).",
    'Evidence to suggest if relevant: ' +
      evidenceChecklist(c)
        .map((e) => e.what + ' — ' + e.why)
        .join('\n'),
    book ? renderPlaybook(book, c, c.lang === 'es' || c.lang === 'zh' ? c.lang : 'en') : '',
    `Violation type: ${c.violationType ?? 'unknown'}. Photos: ${photos}.`,
    `Facts (id | key | label = value | provenance | status):\n${facts}`,
  ].join('\n\n');
}
