import { useRef, useState } from 'react';
import { toWav16k } from '../lib/media';
import { cx } from './ui';
import { t, useLang, type Lang } from '../i18n';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
const SPEECH_LANG: Record<Lang, string> = { zh: 'zh-CN', es: 'es-US', en: 'en-US' };
const recognitionCtor = (): (new () => Recognition) | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
const join = (base: string, spoken: string, lang: Lang) => (base && spoken ? base + (lang === 'zh' ? '' : ' ') + spoken : base || spoken);

/**
 * Tap to start / tap to stop.
 * With `onTranscript` and a browser that supports the Web Speech API, words appear in the text box while the user speaks
 * (the user can edit them before sending). Otherwise it records a 16 kHz mono WAV and emits it through `onAudio`.
 */
export function Recorder({
  onAudio,
  onTranscript,
  value = '',
  disabled,
}: {
  onAudio: (wav: Blob) => void;
  onTranscript?: (text: string) => void;
  value?: string;
  disabled?: boolean;
}) {
  const lang = useLang();
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [listening, setListening] = useState<Recognition | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const chunks = useRef<Blob[]>([]);
  const Ctor = recognitionCtor();
  const live = Boolean(onTranscript && Ctor && !liveFailed);

  function startLive() {
    if (!Ctor || !onTranscript) return;
    setErr('');
    const base = value;
    const r = new Ctor();
    r.lang = SPEECH_LANG[lang];
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      let spoken = '';
      for (let i = 0; i < event.results.length; i++) spoken += event.results[i][0].transcript;
      onTranscript(join(base, spoken.trim(), lang));
    };
    r.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setErr(t(event.error === 'not-allowed' ? 'chat.micError' : 'chat.liveFallback'));
      if (event.error !== 'not-allowed') setLiveFailed(true);
    };
    r.onend = () => setListening(null);
    try {
      r.start();
      setListening(r);
    } catch {
      setLiveFailed(true);
      setErr(t('chat.liveFallback'));
    }
  }

  async function startRecording() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr(t('chat.micHttps'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported?.(m));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setBusy(true);
        try {
          onAudio(await toWav16k(new Blob(chunks.current, { type: r.mimeType })));
        } catch {
          setErr(t('chat.audioError'));
        } finally {
          setBusy(false);
        }
      };
      r.start();
      setRec(r);
    } catch {
      setErr(t('chat.micError'));
    }
  }

  const active = Boolean(rec || listening);
  const toggle = () => {
    if (listening) return listening.stop();
    if (rec) {
      rec.stop();
      return setRec(null);
    }
    return live ? startLive() : void startRecording();
  };
  return (
    <div>
      <button
        type="button"
        disabled={disabled || busy}
        aria-pressed={active}
        onClick={toggle}
        className={cx(
          'no-callout min-h-11 min-w-11 w-full rounded-xl px-3 py-2 text-sm font-semibold',
          active ? 'animate-pulse bg-rose-600 text-white' : 'bg-violet-100 text-violet-900',
          (disabled || busy) && 'opacity-50',
        )}
      >
        {t(busy ? 'chat.converting' : listening ? 'chat.liveListening' : rec ? 'chat.stop' : 'chat.record')}
      </button>
      {live && <p className="mt-1 text-xs text-slate-500">{t('chat.liveHint')}</p>}
      {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
    </div>
  );
}
