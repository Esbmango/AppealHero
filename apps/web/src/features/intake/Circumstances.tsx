import { CIRCUMSTANCE_CHOICES, CIRCUMSTANCE_QUESTION, CircumstanceChoiceSchema, type CircumstanceChoice } from '@appealhero/shared';
import { t, useLang } from '../../i18n';
import { Button } from '../../components/ui';
export function Circumstances({ value, onChange }: { value: CircumstanceChoice[]; onChange: (choices: CircumstanceChoice[]) => void }) {
  const lang = useLang();
  return (
    <details className="rounded-lg border bg-white p-3">
      <summary>
        {t('intake.circumstances')}
        {value.length > 0 && ` (${value.length})`}
      </summary>
      <fieldset className="my-2">
        <legend className="mb-2 text-sm">{CIRCUMSTANCE_QUESTION[lang]}</legend>
        <div className="flex flex-wrap gap-2">
          {CircumstanceChoiceSchema.options.map((id) => (
            <button
              type="button"
              className="choice-chip"
              key={id}
              aria-pressed={value.includes(id)}
              onClick={() => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])}
            >
              {CIRCUMSTANCE_CHOICES[id].label[lang]}
            </button>
          ))}
        </div>
      </fieldset>
      <Button variant="ghost" onClick={() => onChange([])}>
        {t('intake.skip')}
      </Button>
    </details>
  );
}
