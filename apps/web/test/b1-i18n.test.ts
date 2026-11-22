import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_PERSONAS, CASE_STATES, PORTAL_FIELDS, DISPUTE_REASONS } from '@appealhero/shared';
import { dictionaries, LANGUAGES, setLang, t, factText } from '../src/i18n';
import { personaProfile, validProfile } from '../src/features/onboarding/profile';

afterEach(() => setLang('zh'));
describe('B1 locale and profile boundaries', () => {
  it('has matching nonempty translations and interpolation variables in all languages', () => {
    const keys = Object.keys(dictionaries.zh).sort();
    for (const lang of LANGUAGES) {
      expect(Object.keys(dictionaries[lang]).sort()).toEqual(keys);
      for (const key of keys) {
        expect(dictionaries[lang][key].trim(), `${lang}: ${key}`).not.toBe('');
        expect((dictionaries[lang][key].match(/\{\w+\}/g) ?? []).sort(), `${lang}: ${key}`).toEqual((dictionaries.zh[key].match(/\{\w+\}/g) ?? []).sort());
      }
      for (const state of CASE_STATES) expect(dictionaries[lang][`common.states.${state}`]).toBeTruthy();
      for (const field of PORTAL_FIELDS) expect(dictionaries[lang][`review.fields.${field.id}`]).toBeTruthy();
      for (const reason of Object.keys(DISPUTE_REASONS)) expect(dictionaries[lang][`review.reasons.${reason}`]).toBeTruthy();
    }
  });
  it('switches labels immediately and interpolates values without treating them as markup', () => {
    setLang('es');
    expect(t('chat.send')).toBe('Enviar');
    expect(t('onboarding.using', { name: '<Lin>' })).toBe('Perfil: <Lin>');
    setLang('en');
    expect(t('chat.send')).toBe('Send');
    setLang('zh');
    expect(t('chat.send')).toBe('发送');
  });
  it('copies shared persona data and rejects broken browser storage', () => {
    for (const id of ['lin', 'maria', 'sam'] as const) {
      const profile = personaProfile(id);
      expect(validProfile(profile)).toBe(true);
      expect(profile).toMatchObject({
        name: DEMO_PERSONAS[id].name,
        address: DEMO_PERSONAS[id].mailingAddress,
        email: DEMO_PERSONAS[id].email,
        vehicles: DEMO_PERSONAS[id].vehicles,
      });
      expect(profile.vehicles).not.toBe(DEMO_PERSONAS[id].vehicles);
    }
    for (const value of [null, {}, { ready: true }, { ...personaProfile('lin'), vehicles: [null] }]) expect(validProfile(value)).toBe(false);
  });
  it('shows original user statements instead of the backend English note', () => {
    expect(factText({ key: 'userAccount', value: 'Mi relato', note: 'My account' } as Parameters<typeof factText>[0])).toBe('Mi relato');
  });
});
