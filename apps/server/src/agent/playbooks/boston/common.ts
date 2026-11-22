import type { Defense, L10n, Playbook, PlaybookCtx, Question } from '@appealhero/shared';
import { bostonParts, FINE_TABLE, fineFor, runRule } from '../../rules/boston';

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
/** Only a single, unambiguous weekly restriction is normalized by perception. */
export const postedHoursDefense: Defense = {
  id: 'outside_posted_hours',
  reason: 'SIGNAGE',
  basis: 'evidence',
  verified: true,
  needs: ['issuedAt', 'signText', 'signDays', 'signStart', 'signEnd'],
  holds(c) {
    if (!['signDays', 'signStart', 'signEnd', 'signText'].every((k) => photo(c, k))) return 'unknown';
    const days = value(c, 'signDays')
      ?.split(',')
      .map((v) => v.trim());
    const start = value(c, 'signStart'),
      end = value(c, 'signEnd'),
      issued = c.facts.get('issuedAt')?.value;
    const week = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const hhmm = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (
      !days?.length ||
      !days.every((d) => week.includes(d)) ||
      !start ||
      !end ||
      !hhmm.test(start) ||
      !hhmm.test(end) ||
      start === end ||
      !issued ||
      !Number.isFinite(Date.parse(issued))
    )
      return 'unknown';
    const t = bostonParts(issued);
    const day = t.weekday.toLowerCase();
    const time = String(t.hour).padStart(2, '0') + ':' + String(t.minute).padStart(2, '0');
    const previousDay = week[(week.indexOf(day) + 6) % 7];
    const active =
      start < end ? days.includes(day) && time >= start && time < end : (days.includes(day) && time >= start) || (days.includes(previousDay) && time < end);
    return active ? 'no' : 'yes';
  },
  explain: words(
    'The posted restriction was outside its stated hours.',
    '开票时间不在路牌注明的限制时段内。',
    'La multa se emitió fuera del horario señalado.',
  ),
  draftHint: 'Quote the applicable sign and compare its posted hours to the ticket. Ask for its location and the time of the photo.',
};
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
