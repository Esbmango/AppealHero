import type { Defense, L10n, Playbook, PlaybookCtx, Question } from '@appealhero/shared';
import { bostonParts, FINE_TABLE, fineFor, runRule, samePlate } from '../../rules/boston';

export const words = (en: string, zh: string, es: string): L10n => ({ en, zh, es });
export const value = (c: PlaybookCtx, key: string) => c.facts.get(key)?.value.trim().toLowerCase();
/** True when both facts exist and show the same plate, ignoring spaces, dashes and case. */
export const platesMatch = (c: PlaybookCtx, a: string, b: string) => {
  const x = c.facts.get(a)?.value,
    y = c.facts.get(b)?.value;
  return !!x && !!y && samePlate(x, y);
};
/** Neighborhood names as read from a sticker and a sign: ignore case, punctuation and extra spaces ("BACK-BAY" = "Back Bay"). */
const area = (v?: string) =>
  v
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export const sameArea = (c: PlaybookCtx, a: string, b: string) => {
  const x = area(c.facts.get(a)?.value);
  return !!x && x === area(c.facts.get(b)?.value);
};
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
/** Shared check for every playbook (docs/PLAYBOOKS.md §3): the driver reports that the ticket names a different vehicle. */
export const vehicleDefense: Defense = {
  id: 'different_vehicle',
  reason: 'VEHICLE_INFO',
  basis: 'statement',
  verified: true,
  needs: ['vehicleMatches', 'plateNumber'],
  holds: (c) => (/^(no\b|不一致|不匹配)/i.test(value(c, 'vehicleMatches') ?? '') ? 'yes' : 'no'),
  explain: words('The vehicle details do not match.', '罚单上的车辆信息不符。', 'Los datos del vehículo no coinciden.'),
  draftHint: 'Cite the discrepancy reported by the driver and the plate on the ticket.',
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

export const incidentQuestion = question(
  'parkingAccount',
  'text',
  words(
    'When did you arrive and leave, and where were you parked relative to the signs? What did you see, did you pay or display a permit, and did anything unusual happen?',
    '你几点到、几点离开？车停在路牌的哪个位置，看到了什么？是否缴费或展示许可？当时还有什么特殊情况？',
    '¿A qué horas llegaste y saliste, dónde estacionaste respecto a las señales y qué viste? ¿Pagaste o mostraste un permiso? ¿Ocurrió algo inusual?',
  ),
  words(
    'These details connect the ticket, your account and any supporting records.',
    '这些细节能把罚单、你的陈述和证据联系起来。',
    'Estos datos relacionan la multa, tu relato y los comprobantes.',
  ),
  (c) =>
    !c.facts.has('parkingAccount') &&
    !c.facts.has('userAccount') &&
    c.rules.get('meter_hours_in_effect')?.result !== false &&
    c.rules.get('meter_free_day')?.result !== true,
);
export const duplicateDefense: Defense = {
  id: 'duplicate_notice',
  reason: 'OTHER',
  basis: 'evidence',
  verified: true,
  needs: ['duplicateReport', 'duplicateNotice'],
  holds: (c) => (photo(c, 'duplicateNotice') && !!c.answers.duplicateReport ? 'yes' : 'no'),
  explain: words(
    'Two distinct notices show the same vehicle, time, place and violation.',
    '两张不同编号的罚单记载了相同的车辆、时间、地点和违章事项。',
    'Dos multas distintas indican el mismo vehículo, hora, lugar e infracción.',
  ),
  draftHint:
    'For a reported duplicate, record the driver’s words in duplicateReport and use analyze_evidence with duplicate_notice on the other ticket. Ask for review of both numbers. Never claim either ticket is automatically invalid.',
};
