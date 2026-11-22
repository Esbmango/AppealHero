import { t, setLang, LANGUAGES, type Lang } from '../../i18n';

/** First screen: the user picks a language before anything else. The header switch stays available afterwards. */
export function LanguagePicker({ onChosen }: { onChosen: () => void }) {
  const choose = (language: Lang) => {
    setLang(language);
    onChosen();
  };
  return (
    <div className="flow-scroll space-y-6">
      <div className="space-y-1">
        {LANGUAGES.map((language) => (
          <h1 key={language} lang={language === 'zh' ? 'zh-CN' : language} className="text-2xl font-semibold tracking-tight first:text-3xl">
            {t('onboarding.chooseLanguage', {}, language)}
          </h1>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label={t('onboarding.chooseLanguage', {}, 'en')}>
        {LANGUAGES.map((language) => (
          <button
            key={language}
            type="button"
            data-testid={`choose-lang-${language}`}
            lang={language === 'zh' ? 'zh-CN' : language}
            onClick={() => choose(language)}
            className="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left hover:border-sky-700 focus-visible:border-sky-700"
          >
            <span className="text-xl font-semibold">{t(`common.languages.${language}`, {}, language)}</span>
            <span className="mt-1 text-sm text-slate-600">{t('onboarding.chooseLanguageHint', {}, language)}</span>
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-slate-500">{t('intake.simulated')}</p>
    </div>
  );
}
