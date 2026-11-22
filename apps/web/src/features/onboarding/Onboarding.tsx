import { DEMO_PERSONAS, type PersonaId } from '@appealhero/shared';
import { t, useLang, setLang } from '../../i18n';
import { Button, Card, cx } from '../../components/ui';
import { EMPTY_PROFILE, personaProfile, type Profile } from './profile';

export function ProfileFields({ profile, onChange }: { profile: Profile; onChange: (profile: Profile) => void }) {
  useLang();
  return (
    <div className="space-y-3">
      {(['name', 'address', 'email'] as const).map((key) => (
        <label key={key} className="block text-sm">
          <span className="mb-1 block text-slate-600">{t(`onboarding.${key}`)}</span>
          <input
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-base"
            name={key}
            autoComplete={key === 'address' ? 'street-address' : key}
            type={key === 'email' ? 'email' : 'text'}
            required
            value={profile[key]}
            onChange={(event) => onChange({ ...profile, [key]: event.target.value, persona: 'custom', vehicles: [] })}
          />
        </label>
      ))}
    </div>
  );
}
export function Onboarding({ profile, onChange }: { profile: Profile; onChange: (profile: Profile) => void }) {
  useLang();
  return (
    <form
      className="flex-1 space-y-4 overflow-y-auto p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ ...profile, name: profile.name.trim(), address: profile.address.trim(), email: profile.email.trim(), ready: true });
      }}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">{t('onboarding.eyebrow')}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('onboarding.title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{t('onboarding.intro')}</p>
      </div>
      <div className="space-y-2" role="group" aria-label={t('onboarding.title')}>
        {(Object.keys(DEMO_PERSONAS) as PersonaId[]).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`persona-${id}`}
            aria-pressed={profile.persona === id}
            onClick={() => {
              onChange(personaProfile(id));
              setLang(DEMO_PERSONAS[id].lang);
            }}
            className={cx(
              'flex min-h-16 w-full items-center justify-between rounded-2xl border px-4 py-3 text-left',
              profile.persona === id ? 'border-sky-700 bg-sky-50 ring-1 ring-sky-700' : 'border-slate-200 bg-white',
            )}
          >
            <span>
              <span className="block font-semibold">{t(`onboarding.${id}`)}</span>
              <span className="mt-1 block text-sm text-slate-600">{t(`onboarding.${id}Detail`)}</span>
            </span>
            <span aria-hidden="true" className="text-sky-700">
              {profile.persona === id ? '✓' : ''}
            </span>
          </button>
        ))}
        <button
          type="button"
          data-testid="persona-custom"
          aria-pressed={profile.persona === 'custom'}
          onClick={() => onChange({ ...EMPTY_PROFILE })}
          className={cx(
            'min-h-11 w-full rounded-xl border px-4 py-3 text-left text-sm font-medium',
            profile.persona === 'custom' ? 'border-sky-700 bg-sky-50' : 'border-slate-200 bg-white',
          )}
        >
          {t('onboarding.custom')}
        </button>
      </div>
      <Card>
        <ProfileFields profile={profile} onChange={onChange} />
        {profile.vehicles.map((vehicle) => (
          <p key={vehicle.plate} className="mt-3 text-sm text-slate-600">
            {t('onboarding.vehicle', vehicle)}
          </p>
        ))}
        <p className="mt-3 text-xs leading-relaxed text-slate-500">{t('onboarding.saved')}</p>
      </Card>
      <Button type="submit" className="w-full" disabled={!profile.name.trim() || !profile.address.trim() || !profile.email.trim()}>
        {t('onboarding.continue')}
      </Button>
      <p className="text-xs leading-relaxed text-slate-500">{t('intake.simulated')}</p>
    </form>
  );
}
