import { CIRCUMSTANCE_CHOICES, CircumstanceChoiceSchema, type CircumstanceChoice, type CircumstanceKey } from '@appealhero/shared';
import { z } from 'zod';
import type { CaseRecord } from '../../core/types';
import { upsertFact } from '../policy/facts';

export const isCircumstanceKey = (key: string): key is CircumstanceKey => ['hardship', 'firstVisit', 'outOfState', 'circumstance'].includes(key);
export const personalFacts = (c: CaseRecord) =>
  c.facts.filter((f) => isCircumstanceKey(f.key) && (f.provenance === 'USER_TEXT' || f.provenance === 'USER_VOICE') && f.value.trim());
export function readChoices(raw: string | undefined): CircumstanceChoice[] {
  if (!raw?.trim()) return [];
  return z
    .array(CircumstanceChoiceSchema)
    .max(9)
    .parse(raw.split(',').map((s) => s.trim()));
}
const patterns: Partial<Record<CircumstanceChoice, RegExp>> = {
  student: /\b(?:I(?:'m| am) (?:a |an )?(?:college |university )?student|soy estudiante)\b|我是(?:一名|个)?(?:大学|留)?学生/i,
  hardship:
    /\b(?:I (?:can(?:not|'t|’t) afford|struggle to (?:pay|afford)) (?:the |this |my )?(?:ticket|fine|parking citation)|I (?:am experiencing|face) financial hardship|no puedo pagar (?:esta |la |mi )?multa)\b|我(?:付不起|交不起|缴不起|经济困难)|(?:^|[，,])(?:付不起|交不起|缴不起)/i,
  firstVisit:
    /\b(?:my first (?:visit to Boston|time (?:in Boston|parking (?:here|in Boston)))|mi primera vez (?:en Boston|estacionando (?:aquí|en Boston)))\b|我?第一次(?:来|在).*?(?:波士顿|Boston|停车)/i,
  outOfState:
    /\b(?:I(?:'m| am) (?:visiting |here )?from (?:out of|another) state|I (?:have|drive with) (?:an? )?out.of.state (?:plates?|registration)|vengo de otro estado)\b|我(?:是外州|从外州|来自外州|是外地人)/i,
  breakdown: /\b(?:my (?:car|vehicle) broke down|mi (?:coche|vehículo) se averió)\b|我的?车(?:抛锚|坏了|发生故障)/i,
  emergency: /\b(?:I had (?:a medical|an) emergency|tuve una emergencia)\b|我(?:当时)?(?:突发急病|遇到紧急情况)/i,
  loading: /\b(?:I was (?:un)?loading|estaba (?:cargando|descargando))\b|我(?:当时)?在装卸/i,
  stolen: /\b(?:my (?:car|vehicle) (?:was|had been) stolen|me robaron el (?:coche|vehículo))\b|我的车(?:被盗|被偷)/i,
  sold: /\b(?:I (?:had (?:already )?)?sold (?:the|my) (?:car|vehicle)|ya había vendido el vehículo)\b|我(?:已经)?卖掉了(?:这辆|我的)车/i,
};
export function storeStatement(c: CaseRecord, key: CircumstanceKey, value: string, english: string | undefined, provenance: 'USER_TEXT' | 'USER_VOICE') {
  const previous = c.facts.find((f) => f.key === key);
  if (previous?.value.split('\n').includes(value)) return false;
  upsertFact(c, {
    key,
    label: key,
    value: [previous?.value, value].filter(Boolean).join('\n'),
    note: [previous?.note ?? previous?.value, english ?? value].filter(Boolean).join('\n'),
    status: 'USER_STATEMENT',
    provenance,
  });
  return true;
}
export function recordChoices(c: CaseRecord, choices: CircumstanceChoice[]) {
  const lang = c.lang === 'zh' || c.lang === 'es' ? c.lang : 'en';
  let changed = false;
  for (const id of new Set(choices)) {
    const { key, label } = CIRCUMSTANCE_CHOICES[id];
    if (storeStatement(c, key, label[lang], label.en, 'USER_TEXT')) changed = true;
  }
  return changed;
}
// Recognize explicit statements and exact chip text in both drivers.
// Never derive hardship or visitor status from the persona, registration state or OCR.
export function readPersonalStatement(c: CaseRecord, text: string, provenance: 'USER_TEXT' | 'USER_VOICE') {
  let changed = false;
  for (const clause of text
    .split(/[.!?。！？;；\n]+/u)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (
      /\b(?:if|hypothetically|not (?:a |my first|from|experiencing)|no longer|no soy|no es mi primera|sin dificultades)\b|如果|我不是|并非|没有经济困难|不是我第一次/i.test(
        clause,
      )
    )
      continue;
    const translations = new Map<CircumstanceKey, Set<string>>();
    for (const id of CircumstanceChoiceSchema.options) {
      const { key, label } = CIRCUMSTANCE_CHOICES[id];
      if (!Object.values(label).some((v) => v.replace(/[.。]$/u, '').toLowerCase() === clause.toLowerCase()) && !patterns[id]?.test(clause)) continue;
      const english = /[\p{Script=Han}]|\b(?:soy|tengo|tuve|era|pagar|estaba|mi vehículo|me robaron|había|vengo|primera)\b/iu.test(clause) ? label.en : clause;
      const phrases = translations.get(key) ?? new Set<string>();
      phrases.add(english);
      translations.set(key, phrases);
    }
    for (const [key, phrases] of translations) {
      if (storeStatement(c, key, clause, [...phrases].join(' '), provenance)) changed = true;
    }
  }
  return changed;
}
