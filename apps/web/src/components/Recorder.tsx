import { useEffect, useRef, useState } from 'react';
import { toWav16k } from '../lib/media';
import { recognitionCtor, startDictation, type DictationError } from '../lib/speech';
import { cx } from './ui';
import { MicIcon, StopIcon } from './icons';
import { t, useLang } from '../i18n';

/** Longest recording or dictation. Tests may shorten it with window.__ahMaxRecordMs. */
export const MAX_RECORD_MS = 90_000;
const maxMs = () => (typeof window !== 'undefined' && Number((window as { __ahMaxRecordMs?: number }).__ahMaxRecordMs)) || MAX_RECORD_MS;
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const ERROR_KEY: Record<DictationError | 'insecure' | 'audio', string> = {
  denied: 'chat.micDenied',
  'no-mic': 'chat.micMissing',
  unavailable: 'chat.liveFallback',
  insecure: 'chat.micHttps',
  audio: 'chat.audioError',
};

type Phase = { kind: 'idle' } | { kind: 'live' } | { kind: 'recording' } | { kind: 'review'; blob: Blob; url: string; ms: number } | { kind: 'converting' };

/**
 * One microphone button for every screen.
 * - With `onTranscript` and a browser that supports the Web Speech API: words appear in the text box while the user
 *   speaks; the user edits and sends them with the normal Send button.
 * - Otherwise it records audio, then shows play / re-record / delete / confirm. Nothing is sent until the user confirms.
 * Both modes show a timer and stop automatically after 90 seconds.
 */
export function Recorder({
  onAudio,
  onTranscript,
  value = '',
  disabled,
  liveOnly = false,
  confirmLabel = 'chat.useRecording',
}: {
  onAudio: (wav: Blob) => void;
  onTranscript?: (text: string) => void;
  value?: string;
  disabled?: boolean;
  /** hide the button where live transcription is unavailable (no audio upload path on this screen) */
  liveOnly?: boolean;
  confirmLabel?: string;
}) {
  const lang = useLang();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [liveFailed, setLiveFailed] = useState(false);
  const [err, setErr] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const dictation = useRef<{ stop(): void } | null>(null);
  const startedAt = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const live = Boolean(onTranscript && recognitionCtor() && !liveFailed);

  const startClock = () => {
    startedAt.current = Date.now();
    setElapsed(0);
    clearInterval(tick.current);
    tick.current = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
  };
  const stopClock = () => clearInterval(tick.current);
  useEffect(
    () => () => {
      stopClock();
      dictation.current?.stop();
      recorder.current?.state === 'recording' && recorder.current.stop();
    },
    [],
  );
  useEffect(() => {
    if (phase.kind === 'review') return () => URL.revokeObjectURL(phase.url);
  }, [phase]);

  function startLive() {
    if (!onTranscript) return;
    setErr('');
    const base = value;
    const glue = base && lang !== 'zh' ? ' ' : '';
    startClock();
    setPhase({ kind: 'live' });
    dictation.current = startDictation({
      lang,
      maxMs: maxMs(),
      onText: (spoken) => onTranscript(spoken ? base + glue + spoken : base),
      onError: (error) => {
        setErr(t(ERROR_KEY[error]));
        if (error === 'unavailable') setLiveFailed(true);
      },
      onEnd: () => {
        stopClock();
        dictation.current = null;
        setPhase({ kind: 'idle' });
      },
    });
  }

  async function startRecording() {
    setErr('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr(t(ERROR_KEY.insecure));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as { name?: string }).name;
      setErr(t(name === 'NotAllowedError' || name === 'SecurityError' ? ERROR_KEY.denied : name === 'NotFoundError' ? ERROR_KEY['no-mic'] : 'chat.micError'));
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported?.(m));
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      stopClock();
      const ms = Date.now() - startedAt.current;
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      setPhase(blob.size ? { kind: 'review', blob, url: URL.createObjectURL(blob), ms } : { kind: 'idle' });
    };
    recorder.current = r;
    r.start(1000);
    startClock();
    setPhase({ kind: 'recording' });
  }

  // Auto-stop at the limit (recording mode; dictation stops itself).
  useEffect(() => {
    if (phase.kind === 'recording' && elapsed >= maxMs()) recorder.current?.stop();
  }, [elapsed, phase.kind]);

  async function confirm(blob: Blob) {
    setPhase({ kind: 'converting' });
    try {
      onAudio(await toWav16k(blob));
      setPhase({ kind: 'idle' });
    } catch {
      setErr(t(ERROR_KEY.audio));
      setPhase({ kind: 'idle' });
    }
  }

  if (liveOnly && !live && phase.kind === 'idle') return err ? <p className="mt-1 text-xs text-rose-700">{err}</p> : null;

  if (phase.kind === 'review')
    return (
      <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-2" data-testid="recording-review">
        <p className="text-xs font-medium text-navy">{t('chat.recordingReady', { time: clock(phase.ms) })}</p>
        <audio controls src={phase.url} className="w-full" preload="metadata" />
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm text-navy"
            onClick={() => void startRecording()}
            disabled={disabled}
          >
            {t('chat.reRecord')}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm text-rose-700"
            onClick={() => setPhase({ kind: 'idle' })}
          >
            {t('chat.deleteRecording')}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-lg bg-navy px-2 text-sm font-semibold text-white"
            disabled={disabled}
            onClick={() => void confirm(phase.blob)}
          >
            {t(confirmLabel)}
          </button>
        </div>
      </div>
    );

  const active = phase.kind === 'live' || phase.kind === 'recording';
  const label =
    phase.kind === 'converting'
      ? t('chat.converting')
      : phase.kind === 'live'
        ? t('chat.liveListening', { time: clock(elapsed), max: clock(maxMs()) })
        : phase.kind === 'recording'
          ? t('chat.stop', { time: clock(elapsed), max: clock(maxMs()) })
          : t('chat.record');
  const toggle = () => {
    if (phase.kind === 'live') return dictation.current?.stop();
    if (phase.kind === 'recording') return recorder.current?.stop();
    return live ? startLive() : void startRecording();
  };
  return (
    <div>
      <button
        type="button"
        data-testid="mic"
        disabled={disabled || phase.kind === 'converting'}
        aria-pressed={active}
        onClick={toggle}
        className={cx(
          'no-callout inline-flex min-h-11 min-w-11 w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold',
          active ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-300 bg-white text-navy hover:border-navy',
          (disabled || phase.kind === 'converting') && 'opacity-50',
        )}
      >
        {active ? <StopIcon /> : phase.kind === 'idle' ? <MicIcon /> : null}
        {label}
      </button>
      {live && phase.kind !== 'live' && <p className="mt-1 text-xs text-slate-500">{t('chat.liveHint')}</p>}
      {err && (
        <p role="alert" className="mt-1 text-xs text-rose-700">
          {err}
        </p>
      )}
    </div>
  );
}
