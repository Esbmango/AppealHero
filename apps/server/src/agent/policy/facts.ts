import type { DraftParagraph, Fact, FactStatus } from '@appealhero/shared';
import { newId, now } from '../../core/util';

/** Only these may be typed into the portal. USER_STATEMENT / OCR facts must be confirmed by the user first. */
export const SUBMITTABLE: readonly FactStatus[] = ['CONFIRMED', 'RULE_VERIFIED'];
/** Facts an appeal paragraph may rely on: only what the user confirmed (gate 1) or deterministic rule results.
 *  An unconfirmed USER_STATEMENT can never ground the statement — it must go through FACTS_REVIEW first. */
export const GROUNDABLE: readonly FactStatus[] = ['CONFIRMED', 'RULE_VERIFIED'];

export const latestFact = (c: { facts: Fact[] }, key: string) => c.facts.find((f) => f.key === key);

/** One fact per key; ids are stable so grounds can keep citing them. */
export function upsertFact(c: { facts: Fact[] }, f: Omit<Fact, 'id' | 'updatedAt'>): Fact {
  const existing = c.facts.find((x) => x.key === f.key);
  if (existing) {
    Object.assign(existing, f, { updatedAt: now() });
    if (f.note === undefined) delete existing.note;
    if (f.sourceRef === undefined) delete existing.sourceRef;
    return existing;
  }
  const fact: Fact = { ...f, id: newId('f'), updatedAt: now() };
  c.facts.push(fact);
  return fact;
}

/** Facts the user still has to look at in FACTS_REVIEW (gate 1): OCR / photo / lookup findings and their own statements. */
export const PENDING_STATUSES: readonly FactStatus[] = ['NEEDS_CONFIRMATION', 'USER_STATEMENT'];
export const pendingFactIds = (c: { facts: Fact[] }) => c.facts.filter((f) => PENDING_STATUSES.includes(f.status)).map((f) => f.id);

/** Every agent-written paragraph must cite at least one existing fact; paragraphs the user wrote may cite none. */
export function validateGrounds(paragraphs: DraftParagraph[], facts: Fact[]): string[] {
  const ids = new Set(facts.map((f) => f.id));
  const errors: string[] = [];
  paragraphs.forEach((p, i) => {
    if (!p.factIds.length && p.author !== 'user') errors.push(`Paragraph ${i + 1} cites no facts`);
    for (const id of p.factIds) if (!ids.has(id)) errors.push(`Paragraph ${i + 1} cites unknown fact ${id}`);
  });
  return errors;
}

/** Fact ids cited by the draft that the user still has to confirm (e.g. OCR or photo findings). */
export function factsNeedingConfirmation(paragraphs: DraftParagraph[], facts: Fact[]): string[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out = new Set<string>();
  for (const p of paragraphs)
    for (const id of p.factIds) {
      const f = byId.get(id);
      if (f && !GROUNDABLE.includes(f.status)) out.add(id);
    }
  return [...out];
}
