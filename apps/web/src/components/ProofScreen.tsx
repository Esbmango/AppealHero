import { useEffect, useState } from 'react';
import type { ProofResponse } from '@appealhero/shared';
import { api } from '../api';
import { t, useLang, formatDate } from '../i18n';
import { BrandBar } from './BrandBar';
import { Button } from './ui';
export function ProofScreen({ caseId }: { caseId: string }) {
  const lang = useLang();
  const [proof, setProof] = useState<ProofResponse>(),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [checked, setChecked] = useState<Awaited<ReturnType<typeof api.checkStatus>>>();
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(false);
    void api
      .proof(caseId)
      .then(
        (value) => {
          if (active) setProof(value);
        },
        () => {
          if (active) setError(true);
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [caseId, attempt]);
  async function recheck() {
    setBusy(true);
    setError(false);
    try {
      setChecked(await api.checkStatus(caseId));
      setProof(await api.proof(caseId));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="phone-flow flex h-full min-w-0 flex-col" lang={lang === 'zh' ? 'zh-CN' : lang}>
      <header className="flow-header shrink-0 border-b bg-white">
        <BrandBar />
        <a href="/" className="inline-flex min-h-11 items-center text-sm text-sky-700 underline">
          {t('filing.backToApp')}
        </a>
      </header>
      <div className="flow-scroll">
        <section className="space-y-4 rounded-[10px] border border-slate-200 bg-white p-5 text-sm shadow-sm" aria-label={t('filing.proof')}>
          {error && (
            <p role="alert">
              {t('common.error')}{' '}
              <Button variant="ghost" onClick={() => setAttempt((a) => a + 1)}>
                {t('filing.retry')}
              </Button>
            </p>
          )}
          {busy && <p role="status">{t('filing.loadingProof')}</p>}
          {proof && (
            <>
              <h1 className="serif-title text-2xl font-bold tracking-tight text-navy">{t('filing.proofTitle')}</h1>
              <div className="rounded-lg bg-teal-50 px-4 py-3 text-teal-950">
                <p className="text-xs">{t('filing.confirmation')}</p>
                <p className="my-1 font-mono text-xl font-bold">{proof.receipt?.confirmationNumber ?? '—'}</p>
                <p className="text-xs">{t(proof.receipt?.emailVerified ? 'filing.emailConfirmed' : 'filing.emailPending')}</p>
              </div>
              <p className="font-semibold" data-testid="proof-match">
                {t(proof.readbackMatches === undefined ? 'filing.noComparison' : proof.readbackMatches ? 'filing.hashMatch' : 'filing.hashMismatch')}
              </p>
              <dl className="divide-y divide-slate-200 rounded-lg bg-slate-50 px-3 text-xs">
                {[
                  [t('filing.approvedHash'), proof.approvedPayloadHash],
                  [t('filing.readHash'), proof.readbackHash],
                  [t('filing.auditHead'), proof.auditHead],
                ].map(([label, value]) => (
                  <div key={label} className="py-2">
                    <dt className="mb-1 font-semibold text-slate-600">{label}</dt>
                    <dd className="break-all font-mono">{value ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs">{t('filing.auditHelp')}</p>
              {proof.steps.length > 0 && (
                <details>
                  <summary>{t('filing.timeline', { count: proof.steps.length })}</summary>
                  <ol className="space-y-3">
                    {proof.steps.map((step, i) => (
                      <li key={i} className="border-l-2 pl-3">
                        <time>{formatDate(step.at)}</time>
                        <p>
                          {step.step} · {t(`filing.step.${step.status}`)}
                        </p>
                        {step.detail && <p>{step.detail}</p>}
                        {step.screenshotUrl && (
                          <a href={step.screenshotUrl} target="_blank" rel="noreferrer">
                            <img loading="lazy" alt={step.step} className="mt-1 w-full rounded" src={step.screenshotUrl} />
                          </a>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy} onClick={recheck}>
                  {t('filing.recheck')}
                </Button>
                {proof.traceUrl && (
                  <a className="choice-chip inline-flex items-center" href={proof.traceUrl} download>
                    {t('filing.downloadTrace')}
                  </a>
                )}
              </div>
              {checked && (
                <p role="status">
                  {t(checked.found ? 'filing.statusFound' : 'filing.statusMissing', { time: formatDate(checked.checkedAt) })} {checked.confirmationNumber}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
