import { LANGS } from '@appealhero/shared';
import type { CaseRecord } from '../../core/types';

/**
 * Context builder (owner: WP2). Rebuilt every turn by code: role & limits → language → facts → evidence.
 * WP2 adds: account profile + vehicles, the matched playbook rendered as text (renderPlaybook), rule results.
 */
export function buildSystemPrompt(c: CaseRecord): string {
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
    'Honesty: if there is no lawful ground (e.g. a hydrant ticket with correct vehicle details), call propose_outcome with recommendation=PAY and explain the fine, late penalty and deadline. Never help the user claim something their own evidence contradicts.',
    "To APPEAL you need a dispute_reason, grounds citing fact ids, and the appellant's full name, mailing address and email (ask, then record_fact).",
    `Violation type: ${c.violationType ?? 'unknown'}. Photos: ${photos}.`,
    `Facts (id | key | label = value | provenance | status):\n${facts}`,
  ].join('\n\n');
}
