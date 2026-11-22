import { t, useLang, setLang, isLang, LANGUAGES } from '../i18n';
export function BrandBar() {
  const lang = useLang();
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="font-bold">{t('common.brand')}</div>
      <select
        aria-label={t('common.language')}
        data-testid="language-switch"
        value={lang}
        onChange={(event) => {
          if (isLang(event.target.value)) setLang(event.target.value);
        }}
        className="min-h-11 rounded-xl border border-slate-200 bg-white px-2 text-sm"
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
