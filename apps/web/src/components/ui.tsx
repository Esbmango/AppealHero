import type { ReactNode } from 'react';
import type { CaseState, FactStatus, Provenance } from '@appealhero/shared';
import { t, useLang } from '../i18n';

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
    <section className={cx('min-w-0 rounded-[10px] border p-3 sm:p-4', toneCls)}>
      {title && <h3 className="mb-2 text-sm font-semibold text-navy">{title}</h3>}
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
    primary: 'bg-navy text-white hover:bg-slate-700 disabled:bg-slate-300 disabled:text-slate-500',
    ghost: 'bg-white text-navy border border-slate-300 hover:border-navy disabled:text-slate-400',
    danger: 'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-200',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx('min-h-11 min-w-11 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors', v, className)}
    >
      {children}
    </button>
  );
}

const PROV: Record<Provenance, string> = {
  TICKET_OCR: 'bg-sky-100 text-sky-800',
  PORTAL_LOOKUP: 'bg-teal-100 text-teal-800',
  USER_VOICE: 'bg-violet-100 text-violet-800',
  USER_TEXT: 'bg-violet-100 text-violet-800',
  PHOTO_EVIDENCE: 'bg-amber-100 text-amber-800',
  RULE: 'bg-emerald-100 text-emerald-800',
  PROFILE: 'bg-slate-200 text-slate-700',
};

export function ProvBadge({ p }: { p?: Provenance }) {
  useLang();
  if (!p) return null;
  const cls = PROV[p];
  const label = t(`common.provenance.${p}`);
  return <span className={cx('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold', cls)}>[{label}]</span>;
}

export function StatusMark({ s }: { s?: FactStatus }) {
  useLang();
  if (!s) return null;
  const ok = s === 'CONFIRMED' || s === 'RULE_VERIFIED';
  return <span className={cx('text-[10px] font-semibold', ok ? 'text-emerald-700' : 'text-amber-700')}>{t(ok ? 'common.confirmed' : 'common.pending')}</span>;
}

export function StateChip({ state }: { state: CaseState }) {
  useLang();
  const cls =
    state === 'SUBMITTED'
      ? 'bg-emerald-600'
      : ['NEEDS_USER', 'BLOCKED', 'UNKNOWN_RESULT'].includes(state)
        ? 'bg-amber-500'
        : state === 'FAILED'
          ? 'bg-rose-600'
          : 'bg-slate-800';
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold text-white', cls)}>{t(`common.states.${state}`)}</span>;
}

export const ms = (n: number) => (n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
