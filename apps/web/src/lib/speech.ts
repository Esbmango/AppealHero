/**
 * Live dictation with the browser's Web Speech API.
 *
 * Browsers disagree on how results arrive:
 * - desktop Chrome / Safari (continuous): one result per phrase, interim results are replaced in place;
 * - Android Chrome (continuous): results repeat cumulatively ("I", "I paid", "I paid for parking"), often all final.
 * So Android listens one utterance at a time (continuous=false) and restarts until the user taps stop, and every
 * browser goes through `mergeSegments`, which drops repeated and cumulative copies of the same phrase.
 */
export type SpeechLang = 'zh' | 'es' | 'en';
const LOCALE: Record<SpeechLang, string> = { zh: 'zh-CN', es: 'es-US', en: 'en-US' };

type ResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex?: number; results: ResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
};
type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

const norm = (s: string) => s.toLowerCase().replace(/[\s.,!?;:，。！？；：、]+/g, '');
const glue = (lang: SpeechLang) => (lang === 'zh' ? '' : ' ');

/** Join recognised phrases, dropping exact repeats and cumulative copies ("I paid" then "I paid for parking"). */
export function mergeSegments(segments: string[], lang: SpeechLang): string {
  const kept: string[] = [];
  for (const raw of segments) {
    const text = raw.trim();
    if (!text) continue;
    const last = kept[kept.length - 1];
    if (last !== undefined) {
      const a = norm(last);
      const b = norm(text);
      if (b === a || (a.startsWith(b) && b.length > 0)) continue; // repeat or shorter copy
      if (b.startsWith(a)) {
        kept[kept.length - 1] = text; // cumulative: the longer phrase replaces the earlier one
        continue;
      }
    }
    kept.push(text);
  }
  return kept.join(glue(lang));
}

/** Final phrases of one recognition session, then the newest interim phrase (shown while speaking). */
export function sessionSegments(results: ResultList): { finals: string[]; interim: string } {
  const finals: string[] = [];
  let interim = '';
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.isFinal) finals.push(r[0].transcript);
    else interim = r[0].transcript;
  }
  return { finals, interim };
}

export type DictationError = 'denied' | 'no-mic' | 'unavailable';

/**
 * Starts listening; `onText` receives the whole dictated text so far (committed + interim).
 * Stops on `stop()`, on a fatal error, or after `maxMs`. Never sends anything by itself.
 */
export function startDictation(opts: {
  lang: SpeechLang;
  onText: (text: string) => void;
  onError: (error: DictationError) => void;
  onEnd: () => void;
  maxMs: number;
  ctor?: RecognitionCtor;
  android?: boolean;
}) {
  const Ctor = opts.ctor ?? recognitionCtor();
  if (!Ctor) {
    opts.onError('unavailable');
    opts.onEnd();
    return { stop() {} };
  }
  const android = opts.android ?? isAndroid();
  let committed: string[] = [];
  let stopped = false;
  let current: Recognition | null = null;
  let restarts = 0;
  const emit = (session: { finals: string[]; interim: string }) => opts.onText(mergeSegments([...committed, ...session.finals, session.interim], opts.lang));
  const finish = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try {
      current?.stop();
    } catch {
      /* already stopped */
    }
    opts.onEnd();
  };
  const timer = setTimeout(finish, opts.maxMs);

  const listen = () => {
    const r = new Ctor();
    current = r;
    let session = { finals: [] as string[], interim: '' };
    r.lang = LOCALE[opts.lang];
    r.continuous = !android;
    r.interimResults = true;
    r.onresult = (event) => {
      session = sessionSegments(event.results);
      emit(session);
    };
    r.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      opts.onError(event.error === 'not-allowed' ? 'denied' : event.error === 'audio-capture' ? 'no-mic' : 'unavailable');
      finish();
    };
    r.onend = () => {
      // Keep what this session heard (interim included: Android may end before marking it final).
      committed = [mergeSegments([...committed, ...session.finals, session.interim], opts.lang)];
      if (stopped) return;
      if (android && restarts < 200) {
        restarts += 1;
        try {
          listen();
          return;
        } catch {
          /* fall through */
        }
      }
      finish();
    };
    r.start();
  };
  try {
    listen();
  } catch {
    opts.onError('unavailable');
    finish();
  }
  return { stop: finish };
}
