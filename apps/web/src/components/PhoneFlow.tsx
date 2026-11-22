import { useEffect, useRef, useState } from 'react';
import { type AgentEvent, type CaseView, type ChatMessage } from '@appealhero/shared';
import { api } from '../api';
import { t, useLang, setLang, LANGUAGES, isLang, formatDate, fieldLabel } from '../i18n';
import { Onboarding } from '../features/onboarding/Onboarding';
import { useProfile, type Profile } from '../features/onboarding/profile';
import { compressImage } from '../lib/media';
import { Recorder } from './Recorder';
import { ReviewCard } from './ReviewCard';
import { FactsReviewCard } from './FactsReviewCard';
import { Button, Card, StateChip, cx, ms } from './ui';

const EXECUTING = ['APPROVED', 'FILLING', 'SUBMITTING', 'VERIFYING'];
/** INVESTIGATING: answer the agent · FACTS_REVIEW: add info (back to investigation) · STATEMENT_REVIEW: ask for a revision */
const COMPOSER_STATES = ['INVESTIGATING', 'FACTS_REVIEW', 'STATEMENT_REVIEW'];

export function PhoneFlow({
  c,
  events,
  onCreated,
  onNew,
  refresh,
}: {
  c: CaseView | null;
  events: AgentEvent[];
  onCreated: (id: string) => void;
  onNew: () => void;
  refresh: () => void;
}) {
  const lang = useLang();
  const [profile, setProfile] = useProfile();
  const bottom = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and React would treat it as a cleanup fn.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [c?.messages.length, c?.state]);
  return (
    <div className="phone-flow flex h-full min-w-0 flex-col" lang={lang === 'zh' ? 'zh-CN' : lang}>
      <header className="flow-header shrink-0 border-b bg-white">
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
        {c && (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <StateChip state={c.state} />
            <button className="min-h-11 min-w-11 text-sm text-slate-500 underline" onClick={onNew}>
              {t('common.newCase')}
            </button>
          </div>
        )}
      </header>
      {!c ? (
        profile.ready ? (
          <Intake profile={profile} onCreated={onCreated} onChangeProfile={() => setProfile({ ...profile, ready: false })} />
        ) : (
          <Onboarding profile={profile} onChange={setProfile} />
        )
      ) : (
        <>
          <div className="flow-scroll space-y-3">
            <Chat messages={c.messages} />
            <StatePanel c={c} events={events} refresh={refresh} />
            <div ref={bottom} />
          </div>
          {COMPOSER_STATES.includes(c.state) && !(c.triage?.recommendation === 'PAY' && c.state === 'INVESTIGATING') && <Composer c={c} />}
        </>
      )}
    </div>
  );
}

function Intake({ profile, onCreated, onChangeProfile }: { profile: Profile; onCreated: (id: string) => void; onChangeProfile: () => void }) {
  const lang = useLang();
  const [photo, setPhoto] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [audio, setAudio] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const startedAt = useRef(Date.now());

  async function useSample() {
    setErr('');
    try {
      const response = await fetch('/sample-ticket.png');
      if (!response.ok) throw new Error('sample unavailable');
      const blob = await response.blob();
      setPhoto(new File([blob], 'sample-ticket.png', { type: blob.type || 'image/png' }));
    } catch {
      setErr(t('common.error'));
    }
  }

  async function submit() {
    if (!photo || busy) return;
    setBusy(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('ticket', await compressImage(photo));
      if (audio) fd.append('audio', audio, 'voice.wav');
      if (text.trim()) fd.append('text', text.trim());
      fd.append('lang', lang);
      fd.append('profileName', profile.name);
      fd.append('profileAddress', profile.address);
      fd.append('profileEmail', profile.email);
      fd.append('activeMs', String(Date.now() - startedAt.current));
      const { caseId } = await api.createCase(fd);
      onCreated(caseId);
    } catch {
      setErr(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flow-scroll space-y-3">
      <Card>
        <p className="text-sm leading-relaxed">{t('intake.intro')}</p>
        <p className="mt-2 text-xs text-slate-500">{t('intake.simulated')}</p>
      </Card>
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
        <p className="text-sm font-semibold">{t('onboarding.using', { name: profile.name })}</p>
        <button className="min-h-11 text-sm text-sky-700 underline" onClick={onChangeProfile}>
          {t('onboarding.change')}
        </button>
      </div>
      <Card title={t('intake.photoTitle')}>
        <label className="relative block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-4 text-center text-sm">
          {photo ? t('intake.photoSelected', { name: photo.name }) : t('intake.photo')}
          <input
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={t('intake.photo')}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
          />
        </label>
        <button className="mt-2 min-h-11 w-full text-sm text-sky-700 underline" onClick={useSample}>
          {t('intake.sample')}
        </button>
      </Card>
      <Card title={t('intake.accountTitle')}>
        <textarea
          className="w-full rounded-lg border p-2 text-base"
          rows={3}
          aria-label={t('intake.accountTitle')}
          placeholder={t('intake.accountPlaceholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="mt-2">
          <Recorder onAudio={setAudio} />
          {audio && <p className="mt-1 text-xs text-violet-800">{t('intake.audioReady', { size: Math.round(audio.size / 1024) })}</p>}
        </div>
      </Card>
      <Button className="w-full py-3" disabled={!photo || busy} onClick={submit}>
        {t(busy ? 'intake.uploading' : 'intake.start')}
      </Button>
      {err && (
        <p role="alert" className="text-sm text-rose-700">
          {err}
        </p>
      )}
    </div>
  );
}

function Chat({ messages }: { messages: ChatMessage[] }) {
  useLang();
  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <div key={m.id} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
          <div
            className={cx(
              'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
              m.role === 'user' ? 'bg-slate-900 text-white' : m.role === 'system' ? 'bg-rose-50 text-rose-800' : 'border bg-white',
            )}
          >
            {m.text}
            {m.textEn && <div className="mt-1 text-[10px] opacity-60">{t('common.english', { text: m.textEn })}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Composer({ c }: { c: CaseView }) {
  useLang();
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  const q = c.pendingQuestion;
  useEffect(() => {
    shownAt.current = Date.now();
  }, [q?.id]);

  async function send(override?: string, audio?: Blob) {
    const message = (override ?? text).trim();
    if (busy || (!message && !photos.length && !audio)) return;
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      if (message) fd.append('text', message);
      for (const p of photos) fd.append('images', await compressImage(p));
      if (audio) fd.append('audio', audio, 'voice.wav');
      fd.append('activeMs', String(Date.now() - shownAt.current));
      await api.postMessage(c.id, fd);
      setText('');
      setPhotos([]);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flow-composer space-y-2 border-t bg-white">
      {q?.options && (
        <div className="flex flex-wrap gap-2">
          {q.options.map((o) => (
            <Button key={o} variant="ghost" disabled={busy} onClick={() => send(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className={cx('relative cursor-pointer rounded-xl px-3 py-2 text-lg', q?.expects === 'photo' ? 'animate-pulse bg-amber-200' : 'bg-slate-100')}>
          📷
          <input
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={t('chat.photo')}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={(e) => setPhotos([...(e.target.files ?? [])])}
          />
        </label>
        <input
          className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"
          aria-label={t('chat.answerPlaceholder')}
          placeholder={t(q?.expects === 'photo' ? 'chat.photoPlaceholder' : 'chat.answerPlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void send()}
        />
        <Button disabled={busy || (!text.trim() && !photos.length)} onClick={() => send()}>
          {t('chat.send')}
        </Button>
      </div>
      {photos.length > 0 && <p className="text-xs text-slate-500">{t('chat.photosSelected', { count: photos.length })}</p>}
      <Recorder
        disabled={busy}
        onAudio={(wav) => {
          void send('', wav);
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

function StatePanel({ c, events, refresh }: { c: CaseView; events: AgentEvent[]; refresh: () => void }) {
  useLang();
  const [info, setInfo] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } finally {
      refresh();
    }
  };

  if (c.state === 'INVESTIGATING' && c.triage?.recommendation === 'PAY') {
    const triage = c.triage;
    return (
      <Card title={t('filing.payTitle')} tone="warn">
        <p className="text-sm">{triage.summary}</p>
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-700">
          {triage.reasons.map((r, i) => (
            <li key={i}>{r.text}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs">
          {t('filing.payDetails', {
            fine: triage.fineAmount ?? '?',
            late: triage.latePenalty ?? '?',
            deadline: triage.deadline ? formatDate(triage.deadline, true) : t('filing.seeTicket'),
          })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => act(() => api.decide(c.id, 'accept_pay'))}>{t('filing.acceptPay')}</Button>
          <Button variant="ghost" onClick={() => act(() => api.decide(c.id, 'appeal_anyway'))}>
            {t('filing.appealAnyway')}
          </Button>
        </div>
      </Card>
    );
  }
  if (c.state === 'FACTS_REVIEW') return <FactsReviewCard c={c} onChanged={refresh} />;
  if (c.state === 'DRAFTING')
    return (
      <Card title={t('review.drafting')}>
        <p className="text-xs text-slate-600">{t('review.draftingHelp')}</p>
      </Card>
    );
  if (c.state === 'STATEMENT_REVIEW') return <ReviewCard c={c} onChanged={refresh} />;
  if (EXECUTING.includes(c.state)) return <Progress events={events} />;
  if (c.state === 'UNKNOWN_RESULT')
    return (
      <Card title={t('filing.unknown')} tone="warn">
        <Progress events={events} />
        <Button className="mt-2" variant="ghost" onClick={() => act(() => api.resume(c.id, { action: 'reconcile' }))}>
          {t('filing.reconcile')}
        </Button>
      </Card>
    );
  if (c.state === 'NEEDS_USER' || c.state === 'BLOCKED') {
    const nu = c.needsUser;
    return (
      <Card title={t(c.state === 'BLOCKED' ? 'filing.blocked' : 'filing.needsUser')} tone="warn">
        <p className="text-sm">{nu?.reason}</p>
        {nu?.code === 'MISSING_FIELD' && (
          <div className="mt-2 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border p-2 text-sm"
              aria-label={fieldLabel(nu.field ?? '')}
              placeholder={fieldLabel(nu.field ?? '')}
              value={info}
              onChange={(e) => setInfo(e.target.value)}
            />
            <Button disabled={!info.trim()} onClick={() => act(() => api.resume(c.id, { action: 'provide_info', field: nu.field, value: info }))}>
              {t('filing.provideInfo')}
            </Button>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {nu?.code === 'NOT_FOUND_AFTER_UNKNOWN' && (
            <Button variant="ghost" onClick={() => act(() => api.resume(c.id, { action: 'reconcile' }))}>
              {t('filing.reconcile')}
            </Button>
          )}
          {nu?.code !== 'MISSING_FIELD' && (
            <Button onClick={() => act(() => api.resume(c.id, { action: 'retry' }))}>
              {t(nu?.code === 'NOT_FOUND_AFTER_UNKNOWN' ? 'filing.confirmRetry' : 'filing.retry')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => act(() => api.resume(c.id, { action: 'back_to_review' }))}>
            {t('filing.backReview')}
          </Button>
        </div>
        {c.manualPack && <ManualPack rows={c.manualPack} />}
      </Card>
    );
  }
  if (c.state === 'SUBMITTED' && c.receipt)
    return (
      <Card title={t('filing.submitted')} tone="ok">
        <p className="text-sm">
          {t('filing.confirmation')} <b className="font-mono">{c.receipt.confirmationNumber}</b>
        </p>
        <p className="text-xs text-slate-600">
          {t('filing.source', { source: t(c.receipt.source === 'confirmation_page' ? 'filing.confirmationPage' : 'filing.statusLookup') })}
          {c.receipt.alreadyOnFile ? t('filing.alreadyOnFile') : ''}
          {c.receipt.emailVerified ? t('filing.emailVerified') : ''}
        </p>
        <p className="mt-2 text-xs">
          {t('filing.metrics', {
            user: ms(c.metrics.userActiveMs),
            agent: ms(c.metrics.agentMs),
            browser: ms(c.metrics.execMs),
            cost: c.metrics.costUsd.toFixed(4),
          })}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">{t('filing.receiptHelp')}</p>
      </Card>
    );
  if (c.state === 'CLOSED_NO_APPEAL')
    return (
      <Card title={t('filing.closed')} tone="info">
        <p className="text-sm">{t('filing.closedHelp')}</p>
      </Card>
    );
  if (c.state === 'NEW' || c.state === 'IDENTIFYING') return <p className="text-center text-xs text-slate-500">{t('filing.identifying')}</p>;
  if (c.state === 'FAILED') return <Card tone="bad">{t('filing.failed')}</Card>;
  return null;
}

function Progress({ events }: { events: AgentEvent[] }) {
  useLang();
  const steps = events.filter((e): e is Extract<AgentEvent, { type: 'exec.step' }> => e.type === 'exec.step').slice(-8);
  const shot = [...events].reverse().find((e): e is Extract<AgentEvent, { type: 'exec.screenshot' }> => e.type === 'exec.screenshot');
  return (
    <Card title={t('filing.progress')}>
      {shot && <img src={shot.url} alt={shot.label} className="mb-2 w-full rounded-lg border" />}
      <ul className="space-y-1 text-xs">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span
              className={cx('w-12 shrink-0 font-mono', s.status === 'blocked' ? 'text-rose-600' : s.status === 'fail' ? 'text-amber-600' : 'text-emerald-700')}
            >
              {s.tier ?? t(`filing.stepStatus.${s.status}`)}
            </span>
            <span className="truncate">
              {s.step} {s.detail ? `· ${s.detail}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ManualPack({ rows }: { rows: { label: string; value: string }[] }) {
  useLang();
  return (
    <details className="mt-3 rounded-xl border bg-white p-2 text-xs">
      <summary className="font-semibold">{t('filing.manualPack')}</summary>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start justify-between gap-2">
            <span className="text-slate-500">{r.label}</span>
            <button
              aria-label={t('filing.copy', { label: r.label })}
              className="min-h-11 min-w-11 text-right font-medium underline decoration-dotted"
              onClick={() => navigator.clipboard?.writeText(r.value)}
            >
              {r.value.length > 60 ? `${r.value.slice(0, 60)}…` : r.value}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
