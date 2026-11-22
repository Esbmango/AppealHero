import type { Defense, L10n, Playbook, PlaybookCtx, Question } from '@appealhero/shared';
import { FINE_TABLE, fineFor, runRule } from '../../rules/boston';

export const words = (en: string, zh: string, es: string): L10n => ({ en, zh, es });
export const value = (c: PlaybookCtx, key: string) => c.facts.get(key)?.value.trim().toLowerCase();
export const photo = (c: PlaybookCtx, key: string) => c.facts.get(key)?.provenance === 'PHOTO_EVIDENCE';
export const trafficRules = 'https://www.boston.gov/sites/default/files/file/2025/01/City%20of%20Boston%20Traffic%20Rules%20and%20Regulations%203.1.2025.pdf';
export const fines = (...names: string[]) => names.map((violation) => ({ violation, ...FINE_TABLE[violation] }));
export function question(id: string, expects: Question['expects'], text: L10n, why: L10n, askIf: Question['askIf'], records = id): Question {
  return { id, expects, text, why, askIf, records };
}
export function pay(why: L10n): Playbook['recommendPay'] {
  return (c) => {
    if (!c.ticket || !Number.isFinite(Date.parse(c.ticket.issuedAt))) return null;
    const f = fineFor(c.ticket.violation, c.ticket.fine);
    if (f.fine === undefined || f.late === undefined) return null;
    return { fine: f.fine, late: f.late, deadline: String(runRule('appeal_deadline', { issuedAt: c.ticket.issuedAt }).result), why };
  };
}
export const signDefense: Defense = {
  id: 'obscured_sign',
  reason: 'SIGNAGE',
  basis: 'evidence',
  verified: true,
  needs: ['signVisibility', 'signText'],
  holds: (c) => (photo(c, 'signVisibility') && ['partially_obscured', 'not_visible'].includes(value(c, 'signVisibility') ?? '') ? 'yes' : 'no'),
  explain: words('The photo shows an obscured sign.', '照片显示路牌被遮挡。', 'La foto muestra una señal tapada.'),
  draftHint: 'Describe what is visible and when and where the photo was taken. Do not claim that a later photo proves earlier conditions.',
};
