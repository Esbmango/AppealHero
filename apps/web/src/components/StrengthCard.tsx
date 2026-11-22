import { PhotoButtons } from './PhotoPicker';
import { useState } from 'react';
import type { CaseView } from '@appealhero/shared';
import { t, formatDate } from '../i18n';
import { api } from '../api';
import { compressImage } from '../lib/media';
import { Card, Button } from './ui';
export function StrengthCard({ c }: { c: CaseView }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const triage = c.triage;
  if (!triage) return null;
  const { strength, considerations = [], rebuttals = [], evidenceToAdd = [] } = triage;
  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('images', await compressImage(file));
      await api.postMessage(c.id, fd);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    setBusy(true);
    setError('');
    try {
      await api.decide(c.id, 'accept_pay');
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={t('review.strengthTitle')} tone={strength === 'STRONG' ? 'ok' : strength === 'MODERATE' ? 'info' : 'warn'}>
      <p data-testid="case-strength" className="text-lg font-bold">
        {t(`review.strength.${strength}`)}
      </p>
      <p className="mt-1 text-sm">{triage.strengthWhy}</p>
      {considerations.length > 0 && (
        <div className="mt-3 text-sm">
          <b>{t('intake.circumstancesLabel')}</b>
          <ul>
            {c.facts
              .filter((f) => considerations.includes(f.id))
              .map((f) => (
                <li key={f.id} className="whitespace-pre-line">
                  {f.value}
                </li>
              ))}
          </ul>
        </div>
      )}
      {rebuttals.length > 0 && (
        <details className="mt-2">
          <summary>{t('review.rebuttals')}</summary>
          <ul className="list-disc pl-5 text-sm">
            {rebuttals.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      {evidenceToAdd.length > 0 && (
        <details>
          <summary>{t('review.evidenceToAdd')}</summary>
          <ul className="space-y-3">
            {evidenceToAdd.map(({ what, why }) => (
              <li key={what}>
                <b className="text-sm">{what}</b>
                <p className="text-xs">{why}</p>
                <PhotoButtons disabled={busy} labelFor={t('review.uploadFor', { what })} onFiles={(files) => void upload(files[0])} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {strength === 'WEAK' && (
        <>
          <dl className="mt-2 space-y-1 text-sm">
            {triage.fineAmount !== undefined && (
              <div>
                <dt className="inline">{t('review.fields.fineAmount')} </dt>
                <dd className="inline">${triage.fineAmount}</dd>
              </div>
            )}
            {triage.latePenalty !== undefined && (
              <div>
                <dt className="inline">{t('review.lateFee')} </dt>
                <dd className="inline">${triage.latePenalty}</dd>
              </div>
            )}
            {triage.deadline && (
              <div>
                <dt className="inline">{t('review.deadline')} </dt>
                <dd className="inline">{formatDate(triage.deadline, true)}</dd>
              </div>
            )}
          </dl>
          <Button variant="ghost" disabled={busy} onClick={close}>
            {t('filing.acceptPay')}
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </Card>
  );
}
