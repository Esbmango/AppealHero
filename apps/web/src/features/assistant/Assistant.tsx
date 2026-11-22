import { Fragment, useEffect, useRef, useState } from 'react';
import type { AnalyzedTicket, TicketListAnalysis } from '@appealhero/shared';
import { api } from '../../api';
import { t, useLang, formatDate } from '../../i18n';
import { Button, Card, cx } from '../../components/ui';
import { Recorder } from '../../components/Recorder';
import { PhotoPicker } from '../../components/PhotoPicker';
import { useLocalStorage } from '../../hooks';
import { compressImage } from '../../lib/media';
import { loadSample } from '../intake/Samples';

type Turn = { role: 'user' | 'assistant'; text: string; screenshot?: boolean; analysis?: TicketListAnalysis };
const STORAGE_KEY = 'appealhero.assistant.v1';
const SYNTHETIC = /^9\d{8}$/;

/** Turn URLs into links that open in a new tab. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s)）]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const day = (iso: string) => formatDate(`${iso}T12:00:00-05:00`, true);

function TicketList({ analysis, onAppeal }: { analysis: TicketListAnalysis; onAppeal: (ticket: AnalyzedTicket) => void }) {
  useLang();
  return (
    <ul className="mt-2 divide-y rounded-xl border border-slate-200 bg-white" data-testid="assistant-tickets">
      {analysis.tickets.map((ticket) => (
        <li key={ticket.ticketNumber} className="space-y-1 px-3 py-2 text-sm" data-ticket={ticket.ticketNumber} data-category={ticket.category}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">#{ticket.ticketNumber}</span>
            <span>{ticket.amountDue === null ? '—' : `$${ticket.amountDue.toFixed(2)}`}</span>
            <span
              className={cx(
                'ml-auto rounded-full px-2 py-0.5 text-xs font-semibold',
                ticket.category === 'OPEN' ? (ticket.overdue ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900') : 'bg-slate-100 text-slate-700',
              )}
            >
              {t(`assistant.cat.${ticket.category}`)}
            </span>
          </div>
          <div className="text-slate-700">
            {ticket.violation} · {day(ticket.issueDate)}
          </div>
          <div className="text-xs text-slate-500">{t('assistant.printed', { status: ticket.status })}</div>
          {ticket.category === 'OPEN' && ticket.deadline && (
            <div className={cx('text-sm font-medium', ticket.overdue ? 'text-rose-700' : 'text-amber-800')}>
              {ticket.overdue
                ? t('assistant.overdue', { date: day(ticket.deadline), days: -(ticket.daysLeft ?? 0) })
                : t('assistant.dueBy', { date: day(ticket.deadline), days: ticket.daysLeft ?? 0 })}
            </div>
          )}
          {ticket.category === 'OPEN' && (
            <Button variant="ghost" className="mt-1" onClick={() => onAppeal(ticket)}>
              {t('assistant.appeal')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Free-form chat. Read-only by design: the server side has no browsing, submitting or approving tools.
 * For the driver's own tickets it points to the official site and reads the screenshot the driver uploads.
 */
export function Assistant({ onAppeal }: { onAppeal: (ticketNumber: string) => void }) {
  const lang = useLang();
  const [stored, setStored] = useLocalStorage<Turn[]>(STORAGE_KEY, []);
  const turns = Array.isArray(stored) ? stored : [];
  const [text, setText] = useState('');
  const [shots, setShots] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'instant' });
  }, [turns.length, busy]);

  async function send(message = text, images = shots, sample = false) {
    const clean = message.trim();
    if (busy || (!clean && !images.length)) return;
    setBusy(true);
    setError('');
    setNotice('');
    const userTurn: Turn = { role: 'user', text: clean, screenshot: images.length > 0 };
    const history = turns.slice(-12).map(({ role, text: turnText }) => ({ role, text: turnText || (role === 'user' ? '(screenshot)' : '') }));
    setStored([...turns, userTurn].slice(-40));
    try {
      const fd = new FormData();
      fd.set('lang', lang);
      fd.set('text', clean);
      fd.set('history', JSON.stringify(history));
      for (const image of images) fd.append('images', sample ? image : await compressImage(image));
      const r = await api.assistant(fd);
      setStored([...turns, userTurn, { role: 'assistant' as const, text: r.reply, analysis: r.analysis }].slice(-40));
      setText('');
      setShots([]);
    } catch {
      setStored(turns); // drop the unanswered turn; the typed text and screenshots stay for a retry
      setError(t('assistant.error'));
    } finally {
      setBusy(false);
    }
  }

  const appeal = (ticket: AnalyzedTicket) => {
    if (SYNTHETIC.test(ticket.ticketNumber)) onAppeal(ticket.ticketNumber);
    else setNotice(t('assistant.appealPhoto'));
  };

  return (
    <div className="space-y-3" data-testid="assistant">
      <Card title={t('assistant.title')}>
        <p className="text-sm leading-relaxed">{t('assistant.intro')}</p>
        <p className="mt-2 text-xs text-slate-500">{t('assistant.readonly')}</p>
        {turns.length > 0 && (
          <button className="mt-1 min-h-11 text-sm text-slate-500 underline" onClick={() => setStored([])}>
            {t('assistant.clear')}
          </button>
        )}
      </Card>
      <div className="space-y-2" aria-live="polite">
        {turns.map((turn, i) => (
          <div key={i} className={cx('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cx(
                'max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed',
                turn.role === 'user' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white',
              )}
            >
              {turn.screenshot && <div className="text-xs opacity-80">{t('assistant.shotAttached')}</div>}
              {turn.text && <Linkified text={turn.text} />}
              {turn.analysis && turn.analysis.tickets.length > 0 && <TicketList analysis={turn.analysis} onAppeal={appeal} />}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-slate-500">{t('assistant.thinking')}</p>}
        <div ref={end} />
      </div>
      {turns.length < 2 && (
        <div className="flex flex-wrap gap-2">
          {(['suggest1', 'suggest2', 'suggest3'] as const).map((key) => (
            <button key={key} className="choice-chip" disabled={busy} onClick={() => void send(t(`assistant.${key}`), [])}>
              {t(`assistant.${key}`)}
            </button>
          ))}
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-amber-800">
          {notice}
        </p>
      )}
      <Card>
        <div className="mb-2">
          <PhotoPicker files={shots} onChange={setShots} max={3} disabled={busy} />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-11 min-w-0 flex-1 rounded-xl border px-3 py-2 text-base"
            rows={2}
            aria-label={t('assistant.placeholder')}
            placeholder={t('assistant.placeholder')}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Button disabled={busy || (!text.trim() && !shots.length)} onClick={() => void send()}>
            {t('assistant.send')}
          </Button>
        </div>
        <div className="mt-2">
          <Recorder disabled={busy} value={text} onTranscript={setText} onAudio={() => undefined} liveOnly />
        </div>
        <button
          className="mt-2 min-h-11 w-full text-sm text-sky-700 underline"
          disabled={busy}
          onClick={async () => void send(text, [await loadSample('sample-lookup-results.png')], true)}
        >
          {t('assistant.sample')}
        </button>
        {error && (
          <p role="alert" className="mt-1 text-sm text-rose-700">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}
