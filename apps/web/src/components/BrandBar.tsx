import { t, useLang, setLang, isLang, LANGUAGES } from '../i18n';

/** Horizontal logo (vector, /brand/logo-primary.svg) + language switch. Small on phones so it never crowds the screen. */
export function BrandBar() {
  const lang = useLang();
  return (
    <div className="flex items-center justify-between gap-2">
      <a href="/" className="flex min-h-11 items-center" aria-label={t('common.brand')}>
        <img src="/brand/logo-primary.svg" alt={t('common.logoAlt')} className="h-7 w-auto sm:h-8" width={259} height={55} />
      </a>
      <select
        aria-label={t('common.language')}
        data-testid="language-switch"
        value={lang}
        onChange={(event) => {
          if (isLang(event.target.value)) setLang(event.target.value);
        }}
        className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm text-navy"
      >
        {LANGUAGES.map((language) => (
          <option key={language} value={language} lang={language}>
            {t(`common.languages.${language}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
