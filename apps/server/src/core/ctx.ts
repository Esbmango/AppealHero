import { isTransientGeminiError } from '../agent/llm';
import { DISPUTE_REASONS, PORTAL_FIELDS, US_STATES, type CaseView, type ChatMessage, type DisputeReason } from '@appealhero/shared';
import type { CaseStore } from './store/cases';
import type { UserRepo } from './store/users';
import type { AuditRepo } from './store/audit';
import type { EventHub } from './hub';
import type { CaseRecord } from './types';
import { approvalPreview, buildApprovalPayload } from '../approval';
import { newId, now } from './util';

export interface Ctx {
  store: CaseStore;
  hub: EventHub;
  /** v2 (WP1) */
  users: UserRepo;
  /** v2 (WP8): hash-chained, append-only */
  audit: AuditRepo;
}

const PREVIEW_STATES = ['STATEMENT_REVIEW', 'APPROVED', 'FILLING', 'SUBMITTING', 'VERIFYING', 'NEEDS_USER', 'BLOCKED', 'UNKNOWN_RESULT', 'SUBMITTED'];
const PACK_STATES = ['NEEDS_USER', 'BLOCKED', 'UNKNOWN_RESULT'];

/** Client-safe projection: no tokens, no file paths, no raw LLM history. */
export function view(c: CaseRecord): CaseView {
  const { approval, llm: _llm, fake: _fake, extraction: _ext, evidence, ...rest } = c;
  return {
    ...rest,
    evidence: evidence.map(({ path: _p, ...e }) => e),
    preview: c.draft && PREVIEW_STATES.includes(c.state) ? approvalPreview(c) : undefined,
    approvedPayloadHash: approval?.payloadHash,
    manualPack: c.draft && PACK_STATES.includes(c.state) ? manualPack(c) : undefined,
  };
}

/** Guaranteed path when automation is blocked: every value in portal order, ready to copy. */
export function manualPack(c: CaseRecord) {
  const p = buildApprovalPayload(c);
  const rows = PORTAL_FIELDS.map((f) => {
    const v = p.fields[f.id];
    const pretty = f.id === 'disputeReason' ? (DISPUTE_REASONS[v as DisputeReason] ?? v) : f.id === 'plateState' ? `${US_STATES[v] ?? v} (${v})` : v;
    return { label: f.label, value: pretty };
  });
  for (const [label, value] of Object.entries(p.extra)) rows.push({ label, value });
  rows.push({ label: 'Evidence files', value: p.evidence.map((e) => e.filename).join(', ') || '—' });
  return rows;
}

export function publishFacts(ctx: Ctx, caseId: string) {
  ctx.hub.emit({ type: 'facts.updated', caseId, facts: ctx.store.must(caseId).facts });
}

export function publishMetrics(ctx: Ctx, caseId: string) {
  ctx.hub.emit({ type: 'metrics', caseId, metrics: ctx.store.must(caseId).metrics });
}

export function say(ctx: Ctx, caseId: string, text: string, extra: Partial<ChatMessage> = {}) {
  const message: ChatMessage = { id: newId('m'), role: 'agent', text, at: now(), ...extra };
  ctx.store.mutate(caseId, (c) => c.messages.push(message));
  ctx.hub.emit({ type: 'agent.message', caseId, message });
  return message;
}

const BUSY: Record<string, string> = {
  zh: 'Gemini 现在太忙（服务暂时不可用），自动重试了几次仍没有成功。请过一两分钟点“新案件”再试一次。',
  es: 'Gemini está saturado en este momento (servicio no disponible). Lo reintentamos varias veces sin éxito. Espera uno o dos minutos y toca «Nuevo caso».',
  en: 'Gemini is overloaded right now (service unavailable). We retried a few times without success. Wait a minute or two, then tap “New case”.',
};

export function reportError(ctx: Ctx, caseId: string, err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  ctx.hub.emit({ type: 'error', caseId, message: raw });
  // The raw error stays in the event stream and the audit (transition reason); the user gets a plain sentence.
  const lang = ctx.store.get(caseId)?.lang ?? 'en';
  const message = isTransientGeminiError(err) ? (BUSY[lang] ?? BUSY.en) : raw;
  try {
    say(ctx, caseId, `⚠️ ${message}`, { role: 'system' });
  } catch {
    /* case may be gone */
  }
}
