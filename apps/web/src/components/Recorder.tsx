import { useRef, useState } from 'react';
import { toWav16k } from '../lib/media';
import { cx } from './ui';

/** Tap to start / tap to stop (more reliable on iOS than press-and-hold). Emits a 16 kHz mono WAV. */
export function Recorder({ onAudio, disabled }: { onAudio: (wav: Blob) => void; disabled?: boolean }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const chunks = useRef<Blob[]>([]);

  async function start() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr('麦克风需要 HTTPS：请用 cloudflared / ngrok 的 https 地址打开。也可以直接用键盘的语音输入。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported?.(m));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setBusy(true);
        try {
          onAudio(await toWav16k(new Blob(chunks.current, { type: r.mimeType })));
        } catch (e) {
          setErr(`音频转换失败：${(e as Error).message}`);
        } finally {
          setBusy(false);
        }
      };
      r.start();
      setRec(r);
    } catch (e) {
      setErr(`无法使用麦克风：${(e as Error).message}`);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={rec ? () => (rec.stop(), setRec(null)) : start}
        className={cx(
          'no-callout w-full rounded-xl px-3 py-2 text-sm font-semibold',
          rec ? 'animate-pulse bg-rose-600 text-white' : 'bg-violet-100 text-violet-900',
          (disabled || busy) && 'opacity-50',
        )}
      >
        {busy ? '转换中…' : rec ? '■ 点一下结束录音' : '🎙 点一下开始说话'}
      </button>
      {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
    </div>
  );
}
