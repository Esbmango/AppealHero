import { useSyncExternalStore } from 'react';
import type { Fact } from '@appealhero/shared';
import zhCommon from './locales/zh/common.json';
import zhOnboarding from './locales/zh/onboarding.json';
import zhIntake from './locales/zh/intake.json';
import zhChat from './locales/zh/chat.json';
import zhReview from './locales/zh/review.json';
import zhFiling from './locales/zh/filing.json';
import zhAssistant from './locales/zh/assistant.json';
import esCommon from './locales/es/common.json';
import esOnboarding from './locales/es/onboarding.json';
import esIntake from './locales/es/intake.json';
import esChat from './locales/es/chat.json';
import esReview from './locales/es/review.json';
import esFiling from './locales/es/filing.json';
import esAssistant from './locales/es/assistant.json';
import enCommon from './locales/en/common.json';
import enOnboarding from './locales/en/onboarding.json';
import enIntake from './locales/en/intake.json';
import enChat from './locales/en/chat.json';
import enReview from './locales/en/review.json';
import enFiling from './locales/en/filing.json';
import enAssistant from './locales/en/assistant.json';

export const LANGUAGES = ['zh', 'es', 'en'] as const;
export type Lang = (typeof LANGUAGES)[number];
export const isLang = (value: unknown): value is Lang => LANGUAGES.includes(value as Lang);
const flatten = (namespaces: Record<string, Record<string, string>>) =>
  Object.fromEntries(Object.entries(namespaces).flatMap(([namespace, values]) => Object.entries(values).map(([key, value]) => [`${namespace}.${key}`, value])));
export const dictionaries: Record<Lang, Record<string, string>> = {
  zh: flatten({ common: zhCommon, onboarding: zhOnboarding, intake: zhIntake, chat: zhChat, review: zhReview, filing: zhFiling, assistant: zhAssistant }),
  es: flatten({ common: esCommon, onboarding: esOnboarding, intake: esIntake, chat: esChat, review: esReview, filing: esFiling, assistant: esAssistant }),
  en: flatten({ common: enCommon, onboarding: enOnboarding, intake: enIntake, chat: enChat, review: enReview, filing: enFiling, assistant: enAssistant }),
};
const STORAGE_KEY = 'cp.lang';
/** First visit: follow the browser language (zh / es), otherwise English. */
const browserLang = (): Lang => {
  const tag = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return tag.startsWith('zh') ? 'zh' : tag.startsWith('es') ? 'es' : 'en';
};
const readLang = (): Lang => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return isLang(value) ? value : browserLang();
  } catch {
    return browserLang();
  }
};
let lang = readLang();
const listeners = new Set<() => void>();
const applyDocumentLang = () => {
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
};
applyDocumentLang();
export function setLang(next: Lang) {
  if (!isLang(next)) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  applyDocumentLang();
  listeners.forEach((listener) => listener());
}
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      lang = readLang();
      applyDocumentLang();
      listeners.forEach((listener) => listener());
    }
  });
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useLang = () =>
  useSyncExternalStore(
    subscribe,
    () => lang,
    () => 'zh' as Lang,
  );
export function t(key: string, vars: Record<string, string | number> = {}, language: Lang = lang): string {
  const template = dictionaries[language][key] ?? dictionaries.zh[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
}
export const fieldLabel = (key: string, fallback = key) => dictionaries[lang][`review.fields.${key}`] ?? fallback;
export const reasonLabel = (reason: string) => dictionaries[lang][`review.reasons.${reason}`] ?? reason;
export const formatDate = (value: string, dateOnly = false) =>
  new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : lang === 'es' ? 'es-US' : 'en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    ...(dateOnly ? {} : { timeStyle: 'short' as const }),
  }).format(new Date(value));
export function factText(fact: Fact) {
  if (['issuedAt', 'paidUntil', 'paidFrom'].includes(fact.key) && !Number.isNaN(Date.parse(fact.value))) {
    return t('common.bostonTime', { date: formatDate(fact.value) });
  }
  // Keep the user's original account; the optional note can be a backend English translation.
  return fact.provenance === 'USER_TEXT' || fact.provenance === 'USER_VOICE' ? fact.value : (fact.note ?? fact.value);
}
