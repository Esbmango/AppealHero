import type { ReactNode } from 'react';
import type { CaseState, FactStatus, Provenance } from '@appealhero/shared';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export function Card({ title, children, tone = 'default' }: { title?: ReactNode; children: ReactNode; tone?: 'default' | 'warn' | 'ok' | 'bad' | 'info' }) {
  const toneCls = {
    default: 'bg-white border-slate-200',
    warn: 'bg-amber-50 border-amber-300',
    ok: 'bg-emerald-50 border-emerald-300',
    bad: 'bg-rose-50 border-rose-300',
    info: 'bg-sky-50 border-sky-200',
  }[tone];
  return (
    <section className={cx('rounded-2xl border p-3 shadow-sm', toneCls)}>
      {title && <h3 className="mb-2 text-sm font-semibold">{title}</h3>}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  className,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  className?: string;
  type?: 'button' | 'submit';
}) {
  const v = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-300',
    ghost: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-100 disabled:text-slate-300',
    danger: 'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-200',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cx('rounded-xl px-3 py-2 text-sm font-medium transition', v, className)}>
      {children}
    </button>
  );
}

const PROV: Record<Provenance, [string, string]> = {
  TICKET_OCR: ['罚单OCR', 'bg-sky-100 text-sky-800'],
  USER_VOICE: ['用户语音', 'bg-violet-100 text-violet-800'],
  USER_TEXT: ['用户陈述', 'bg-violet-100 text-violet-800'],
  PHOTO_EVIDENCE: ['照片证据', 'bg-amber-100 text-amber-800'],
  RULE: ['官方规则', 'bg-emerald-100 text-emerald-800'],
  PROFILE: ['个人资料', 'bg-slate-200 text-slate-700'],
};

export function ProvBadge({ p }: { p?: Provenance }) {
  if (!p) return null;
  const [label, cls] = PROV[p];
  return <span className={cx('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold', cls)}>[{label}]</span>;
}

export function StatusMark({ s }: { s?: FactStatus }) {
  if (!s) return null;
  const ok = s === 'CONFIRMED' || s === 'RULE_VERIFIED';
  return <span className={cx('text-[10px] font-semibold', ok ? 'text-emerald-700' : 'text-amber-700')}>{ok ? '✓ 已确认' : '待确认'}</span>;
}

export const STATE_ZH: Record<CaseState, string> = {
  NEW: '新建',
  EXTRACTED: '已识别',
  INVESTIGATING: '调查中',
  READY_FOR_REVIEW: '待你核对',
  APPROVED: '已批准',
  FILLING: '填写中',
  SUBMITTING: '提交中',
  VERIFYING: '核实回执',
  SUBMITTED: '已提交',
  NEEDS_USER: '需要你',
  BLOCKED: '已暂停',
  UNKNOWN_RESULT: '结果核对中',
  FAILED: '失败',
  CLOSED_NO_APPEAL: '已结案',
};

export function StateChip({ state }: { state: CaseState }) {
  const cls =
    state === 'SUBMITTED'
      ? 'bg-emerald-600'
      : ['NEEDS_USER', 'BLOCKED', 'UNKNOWN_RESULT'].includes(state)
        ? 'bg-amber-500'
        : state === 'FAILED'
          ? 'bg-rose-600'
          : 'bg-slate-800';
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold text-white', cls)}>{STATE_ZH[state]}</span>;
}

export const ms = (n: number) => (n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
