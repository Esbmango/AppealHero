import { canonicalize, type Actor, type AuditEvent } from '@appealhero/shared';
import { now, sha256Hex } from '../util';
import { readJson, writeJsonAtomic } from './json';

/**
 * Append-only, hash-chained audit log, one chain per case (behaviour owner: WP8; WP0 wires state changes).
 * hash_n = sha256(hash_{n-1} + canonical(event_n without its hash)); the first prevHash is 64 zeros.
 */
export const GENESIS = '0'.repeat(64);

export interface AuditRepo {
  append(e: { caseId: string; type: string; actor?: Actor; data?: unknown }): AuditEvent;
  list(caseId: string): AuditEvent[];
  head(caseId: string): string | undefined;
  reset(): void;
  flush(): void;
}

export const hashAuditEvent = (e: Omit<AuditEvent, 'hash'>) => sha256Hex(e.prevHash + canonicalize(e));

/** Recompute the chain; returns the first broken seq (1-based) or null if intact. */
export function verifyChain(events: AuditEvent[]): { ok: true } | { ok: false; brokenAt: number } {
  let prev = GENESIS;
  for (const e of events) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || hashAuditEvent(rest) !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true };
}

export class JsonAuditRepo implements AuditRepo {
  private chains = new Map<string, AuditEvent[]>();
  private timer: NodeJS.Timeout | null = null;
  constructor(private file: string | null) {
    for (const e of readJson<AuditEvent[]>(file, [])) this.chain(e.caseId).push(e);
  }
  private chain(caseId: string) {
    let c = this.chains.get(caseId);
    if (!c) this.chains.set(caseId, (c = []));
    return c;
  }
  append(e: { caseId: string; type: string; actor?: Actor; data?: unknown }): AuditEvent {
    const chain = this.chain(e.caseId);
    const prevHash = chain.at(-1)?.hash ?? GENESIS;
    const base: Omit<AuditEvent, 'hash'> = { seq: chain.length + 1, caseId: e.caseId, at: now(), type: e.type, actor: e.actor, data: e.data ?? null, prevHash };
    const event: AuditEvent = { ...base, hash: hashAuditEvent(base) };
    chain.push(event);
    this.saveSoon();
    return event;
  }
  list(caseId: string) {
    return [...(this.chains.get(caseId) ?? [])];
  }
  head(caseId: string) {
    return this.chains.get(caseId)?.at(-1)?.hash;
  }
  reset() {
    this.chains.clear();
    this.saveSoon();
  }
  private saveSoon() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 50);
  }
  flush() {
    if (this.file) writeJsonAtomic(this.file, [...this.chains.values()].flat());
  }
}
