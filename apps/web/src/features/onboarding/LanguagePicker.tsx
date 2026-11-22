import { t, setLang, useLang, LANGUAGES, type Lang } from '../../i18n';
import { CameraIcon, PinIcon } from '../../components/icons';

/**
 * First screen: what AppealHero is, one primary action, and the language choice.
 * The copy follows the current language (browser language on a first visit; the header switch changes it).
 */
export function LanguagePicker({ onChosen }: { onChosen: () => void }) {
  const lang = useLang();
  const choose = (language: Lang) => {
    setLang(language);
    onChosen();
  };
  return (
    <div className="flow-scroll space-y-4">
      <section className="overflow-hidden rounded-[10px] border border-mist bg-white">
        <div className="grid items-center gap-6 p-5 sm:p-8 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="eyebrow">{t('onboarding.heroEyebrow')}</p>
            <h1 className="serif-title mt-3 text-[1.75rem] font-bold leading-[1.15] tracking-tight text-navy sm:text-[2.35rem]">{t('onboarding.heroTitle')}</h1>
            <p className="mt-3 max-w-prose text-[0.95rem] leading-relaxed text-slate-600">{t('onboarding.heroBody')}</p>
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                data-testid="hero-start"
                onClick={onChosen}
                className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-navy px-5 text-[0.95rem] font-semibold text-white hover:bg-slate-700"
              >
                <CameraIcon />
                {t('onboarding.heroStart')}
              </button>
              <div className="flex flex-wrap items-center text-sm text-slate-600" role="group" aria-label={t('onboarding.chooseLanguage')}>
                <span className="mr-1 sr-only">{t('onboarding.heroOr')}</span>
                {LANGUAGES.map((language, i) => (
                  <span key={language} className="flex items-center">
                    {i > 0 && (
                      <span aria-hidden="true" className="px-0.5 text-slate-400">
                        ·
                      </span>
                    )}
                    <button
                      type="button"
                      data-testid={`choose-lang-${language}`}
                      lang={language === 'zh' ? 'zh-CN' : language}
                      aria-current={language === lang ? 'true' : undefined}
                      onClick={() => choose(language)}
                      className="px-1.5 underline-offset-4 hover:text-navy hover:underline aria-[current=true]:font-semibold aria-[current=true]:text-navy"
                    >
                      {t(`common.languages.${language}`, {}, language)}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <img src="/brand/logo-stacked.svg" alt="" aria-hidden="true" className="hidden h-52 w-auto md:block" />
        </div>
        <div className="flex items-center gap-2 border-t border-mist px-5 py-4 text-sm text-slate-600 sm:px-8">
          <span className="text-brick">
            <PinIcon />
          </span>
          {t('onboarding.heroFoot')}
        </div>
      </section>
      <p className="px-1 text-xs leading-relaxed text-slate-500">{t('onboarding.heroIndependent')}</p>
    </div>
  );
}
