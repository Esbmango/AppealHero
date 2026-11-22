import { useEffect, useRef, useState } from 'react';
import { LANGS, type AgentEvent, type CaseView, type ChatMessage } from '@appealhero/shared';
import { api } from '../api';
import { useLocalStorage } from '../hooks';
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
  const bottom = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and React would treat it as a cleanup fn.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [c?.messages.length, c?.state]);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b bg-white px-3 py-2">
        <div className="font-bold">申诉英雄 AppealHero</div>
        <div className="flex items-center gap-2">
          {c && <StateChip state={c.state} />}
          {c && (
            <button className="text-xs text-slate-500 underline" onClick={onNew}>
              新案件
            </button>
          )}
        </div>
      </header>
      {!c ? (
        <Intake onCreated={onCreated} />
      ) : (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
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

function Intake({ onCreated }: { onCreated: (id: string) => void }) {
  const [lang, setLang] = useLocalStorage<string>('cp.lang', 'zh');
  const [profile, setProfile] = useLocalStorage('cp.profile', { name: '', address: '', email: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [audio, setAudio] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const startedAt = useRef(Date.now());

  async function useSample() {
    const blob = await (await fetch('/sample-ticket.png')).blob();
    setPhoto(new File([blob], 'sample-ticket.png', { type: blob.type || 'image/png' }));
  }

  async function submit() {
    if (!photo) return;
    setBusy(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('ticket', await compressImage(photo));
      if (audio) fd.append('audio', audio, 'voice.wav');
      if (text.trim()) fd.append('text', text.trim());
      fd.append('lang', lang);
      if (profile.name) fd.append('profileName', profile.name);
      if (profile.address) fd.append('profileAddress', profile.address);
      if (profile.email) fd.append('profileEmail', profile.email);
      fd.append('activeMs', String(Date.now() - startedAt.current));
      const { caseId } = await api.createCase(fd);
      onCreated(caseId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      <Card>
        <p className="text-sm">拍下罚单，用你习惯的语言说说发生了什么。我会核对官方规则、只问缺的信息，并在你批准后代你填写提交。</p>
        <p className="mt-1 text-[11px] text-slate-500">演示版仅连接模拟门户，不会向真实政府系统提交。</p>
      </Card>
      <Card title="1 · 罚单照片">
        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-4 text-center text-sm">
          {photo ? `✓ ${photo.name}` : '📷 拍照 / 选择照片'}
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <button className="mt-2 text-xs text-sky-700 underline" onClick={useSample}>
          使用示例罚单（合成数据）
        </button>
      </Card>
      <Card title="2 · 发生了什么（可选）">
        <select className="mb-2 w-full rounded-lg border p-2 text-sm" value={lang} onChange={(e) => setLang(e.target.value)}>
          {Object.entries(LANGS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <textarea
          className="w-full rounded-lg border p-2 text-sm"
          rows={3}
          placeholder="例如：周日下午在 Comm Ave 停车被开了计时器罚单（可用键盘语音输入）"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-2">
          <Recorder onAudio={setAudio} />
          {audio && <p className="mt-1 text-xs text-violet-800">✓ 已录音（{Math.round(audio.size / 1024)} KB WAV）</p>}
        </div>
      </Card>
      <details className="rounded-2xl border bg-white p-3 text-sm">
        <summary className="font-semibold">我的资料（仅存本机，用于申诉表）</summary>
        {(['name', 'address', 'email'] as const).map((k) => (
          <input
            key={k}
            className="mt-2 w-full rounded-lg border p-2"
            placeholder={{ name: '全名（与车辆登记一致）', address: '邮寄地址', email: '邮箱（接收回执）' }[k]}
            value={profile[k]}
            onChange={(e) => setProfile({ ...profile, [k]: e.target.value })}
          />
        ))}
      </details>
      <Button className="w-full py-3" disabled={!photo || busy} onClick={submit}>
        {busy ? '上传中…' : '开始处理这张罚单'}
      </Button>
      {err && <p className="text-xs text-rose-700">{err}</p>}
    </div>
  );
}

function Chat({ messages }: { messages: ChatMessage[] }) {
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
            {m.textEn && <div className="mt-1 text-[10px] opacity-60">EN: {m.textEn}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Composer({ c }: { c: CaseView }) {
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  const q = c.pendingQuestion;
  useEffect(() => {
    shownAt.current = Date.now();
  }, [q?.id]);

  async function send(override?: string, audio?: Blob) {
    const t = (override ?? text).trim();
    if (!t && !photos.length && !audio) return;
    setBusy(true);
    try {
      const fd = new FormData();
      if (t) fd.append('text', t);
      for (const p of photos) fd.append('images', await compressImage(p));
      if (audio) fd.append('audio', audio, 'voice.wav');
      fd.append('activeMs', String(Date.now() - shownAt.current));
      await api.postMessage(c.id, fd);
      setText('');
      setPhotos([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t bg-white p-2">
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
        <label className={cx('cursor-pointer rounded-xl px-3 py-2 text-lg', q?.expects === 'photo' ? 'animate-pulse bg-amber-200' : 'bg-slate-100')}>
          📷
          <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => setPhotos([...(e.target.files ?? [])])} />
        </label>
        <input
          className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"
          placeholder={q?.expects === 'photo' ? '拍照上传，或补充说明…' : '输入回答（可用键盘语音输入）'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <Button disabled={busy || (!text.trim() && !photos.length)} onClick={() => send()}>
          发送
        </Button>
      </div>
      {photos.length > 0 && <p className="text-xs text-slate-500">已选 {photos.length} 张照片</p>}
      <Recorder disabled={busy} onAudio={(wav) => send('', wav)} />
    </div>
  );
}

function StatePanel({ c, events, refresh }: { c: CaseView; events: AgentEvent[]; refresh: () => void }) {
  const [info, setInfo] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } finally {
      refresh();
    }
  };

  if (c.state === 'INVESTIGATING' && c.triage?.recommendation === 'PAY') {
    const t = c.triage;
    return (
      <Card title="诚实建议：这张罚单不建议申诉" tone="warn">
        <p className="text-sm">{t.summary}</p>
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-700">
          {t.reasons.map((r, i) => (
            <li key={i}>{r.text}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs">
          罚款 ${t.fineAmount ?? '?'} · 逾期加收 ${t.latePenalty ?? '?'} · 截止 {t.deadline ? new Date(t.deadline).toLocaleDateString() : '见罚单'}
        </p>
        <div className="mt-3 flex gap-2">
          <Button onClick={() => act(() => api.decide(c.id, 'accept_pay'))}>接受建议，按期缴费</Button>
          <Button variant="ghost" onClick={() => act(() => api.decide(c.id, 'appeal_anyway'))}>
            我仍要申诉
          </Button>
        </div>
      </Card>
    );
  }
  if (c.state === 'FACTS_REVIEW') return <FactsReviewCard c={c} onChanged={refresh} />;
  if (c.state === 'DRAFTING')
    return (
      <Card title="正在撰写申诉信…">
        <p className="text-xs text-slate-600">只使用你刚刚确认过的事实。写好后你可以修改，确认无误再批准。</p>
      </Card>
    );
  if (c.state === 'STATEMENT_REVIEW') return <ReviewCard c={c} onChanged={refresh} />;
  if (EXECUTING.includes(c.state)) return <Progress events={events} />;
  if (c.state === 'UNKNOWN_RESULT')
    return (
      <Card title="提交结果未知 —— 正在查询官方状态，不会重复提交" tone="warn">
        <Progress events={events} />
        <Button className="mt-2" variant="ghost" onClick={() => act(() => api.resume(c.id, { action: 'reconcile' }))}>
          重新核对状态
        </Button>
      </Card>
    );
  if (c.state === 'NEEDS_USER' || c.state === 'BLOCKED') {
    const nu = c.needsUser;
    return (
      <Card title={c.state === 'BLOCKED' ? '已暂停：需要你亲自完成一步' : '需要你的帮助'} tone="warn">
        <p className="text-sm">{nu?.reason}</p>
        {nu?.code === 'MISSING_FIELD' && (
          <div className="mt-2 flex gap-2">
            <input className="min-w-0 flex-1 rounded-lg border p-2 text-sm" placeholder={nu.field} value={info} onChange={(e) => setInfo(e.target.value)} />
            <Button disabled={!info.trim()} onClick={() => act(() => api.resume(c.id, { action: 'provide_info', field: nu.field, value: info }))}>
              补充并重新核对
            </Button>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {nu?.code === 'NOT_FOUND_AFTER_UNKNOWN' && (
            <Button variant="ghost" onClick={() => act(() => api.resume(c.id, { action: 'reconcile' }))}>
              再查一次状态
            </Button>
          )}
          {nu?.code !== 'MISSING_FIELD' && (
            <Button onClick={() => act(() => api.resume(c.id, { action: 'retry' }))}>
              {nu?.code === 'NOT_FOUND_AFTER_UNKNOWN' ? '确认重试（门户不会重复受理）' : '重试'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => act(() => api.resume(c.id, { action: 'back_to_review' }))}>
            回到核对页
          </Button>
        </div>
        {c.manualPack && <ManualPack rows={c.manualPack} />}
      </Card>
    );
  }
  if (c.state === 'SUBMITTED' && c.receipt)
    return (
      <Card title="✅ 申诉已提交（模拟门户）" tone="ok">
        <p className="text-sm">
          确认号 <b className="font-mono">{c.receipt.confirmationNumber}</b>
        </p>
        <p className="text-xs text-slate-600">
          来源：{c.receipt.source === 'confirmation_page' ? '门户确认页' : '门户状态查询'}
          {c.receipt.alreadyOnFile ? '（此前已提交过，未重复提交）' : ''}
          {c.receipt.emailVerified ? ' · 邮件回执已核实' : ''}
        </p>
        <p className="mt-2 text-xs">
          你的操作时间约 {ms(c.metrics.userActiveMs)} · Agent {ms(c.metrics.agentMs)} · 浏览器 {ms(c.metrics.execMs)} · AI 成本 ${c.metrics.costUsd.toFixed(4)}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">市政府通常在 7–10 个工作日内邮寄决定。结果由市政府决定，AppealHero 不保证撤销。</p>
      </Card>
    );
  if (c.state === 'CLOSED_NO_APPEAL')
    return (
      <Card title="已结案：按期缴费" tone="info">
        <p className="text-sm">按期缴费可以避免滞纳金。你随时可以补充信息重新调查。</p>
      </Card>
    );
  if (c.state === 'NEW' || c.state === 'IDENTIFYING') return <p className="text-center text-xs text-slate-500">正在识别罚单…</p>;
  if (c.state === 'FAILED') return <Card tone="bad">处理失败，请新建案件重试。</Card>;
  return null;
}

function Progress({ events }: { events: AgentEvent[] }) {
  const steps = events.filter((e): e is Extract<AgentEvent, { type: 'exec.step' }> => e.type === 'exec.step').slice(-8);
  const shot = [...events].reverse().find((e): e is Extract<AgentEvent, { type: 'exec.screenshot' }> => e.type === 'exec.screenshot');
  return (
    <Card title="正在代你填写（模拟门户）">
      {shot && <img src={shot.url} alt={shot.label} className="mb-2 w-full rounded-lg border" />}
      <ul className="space-y-1 text-xs">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span
              className={cx('w-12 shrink-0 font-mono', s.status === 'blocked' ? 'text-rose-600' : s.status === 'fail' ? 'text-amber-600' : 'text-emerald-700')}
            >
              {s.tier ?? s.status}
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
  return (
    <details className="mt-3 rounded-xl border bg-white p-2 text-xs">
      <summary className="font-semibold">手动提交包（自动化不可用时也能省时间）</summary>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start justify-between gap-2">
            <span className="text-slate-500">{r.label}</span>
            <button className="text-right font-medium underline decoration-dotted" onClick={() => navigator.clipboard?.writeText(r.value)}>
              {r.value.length > 60 ? `${r.value.slice(0, 60)}…` : r.value}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
