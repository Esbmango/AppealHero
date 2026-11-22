import { z } from 'zod';
import type { L10n } from './playbook';

export const CircumstanceChoiceSchema = z.enum(['student', 'hardship', 'outOfState', 'firstVisit', 'emergency', 'breakdown', 'loading', 'stolen', 'sold']);
export type CircumstanceChoice = z.infer<typeof CircumstanceChoiceSchema>;
export type CircumstanceKey = 'hardship' | 'outOfState' | 'firstVisit' | 'circumstance';
export const CIRCUMSTANCE_QUESTION: L10n = {
  en: 'Is there anything you would like the reviewer to consider? Choose any or skip.',
  zh: '你希望审核人员考虑哪些个人情况？可多选，也可跳过。',
  es: '¿Qué circunstancias personales quisieras que se consideraran? Elige las que correspondan u omite la pregunta.',
};
export const CIRCUMSTANCE_CHOICES: Record<CircumstanceChoice, { key: CircumstanceKey; label: L10n }> = {
  student: { key: 'hardship', label: { en: 'I am a student.', zh: '我是学生。', es: 'Soy estudiante.' } },
  hardship: {
    key: 'hardship',
    label: {
      en: 'Paying this fine would cause me financial hardship.',
      zh: '缴纳这笔罚款会给我带来经济困难。',
      es: 'Pagar esta multa me causaría dificultades económicas.',
    },
  },
  outOfState: { key: 'outOfState', label: { en: 'I am visiting from out of state.', zh: '我从外州来访。', es: 'Vengo de otro estado.' } },
  firstVisit: {
    key: 'firstVisit',
    label: { en: 'This was my first time parking in Boston.', zh: '这是我第一次在波士顿停车。', es: 'Era la primera vez que estacionaba en Boston.' },
  },
  emergency: { key: 'circumstance', label: { en: 'I experienced an emergency.', zh: '当时发生了紧急情况。', es: 'Tuve una emergencia.' } },
  breakdown: { key: 'circumstance', label: { en: 'My vehicle broke down.', zh: '当时我的车发生了故障。', es: 'Mi vehículo se averió.' } },
  loading: { key: 'circumstance', label: { en: 'I was loading or unloading.', zh: '我当时在装卸货物。', es: 'Estaba cargando o descargando.' } },
  stolen: { key: 'circumstance', label: { en: 'My vehicle had been stolen.', zh: '当时我的车已经被盗。', es: 'Me habían robado el vehículo.' } },
  sold: { key: 'circumstance', label: { en: 'I had already sold the vehicle.', zh: '当时我已经卖掉了这辆车。', es: 'Ya había vendido el vehículo.' } },
};
