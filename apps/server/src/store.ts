import fs from 'node:fs';
import path from 'node:path';
import type { CaseState } from '@appealhero/shared';
import type { CaseRecord } from './types';
import { HttpError, emptyMetrics, newId, now } from './util';

/**
 * In-memory Map + JSON file. Writes are debounced and atomic (tmp file + rename),
 * so a crash mid-write never leaves a half-written cases.json.
 */
export class CaseStore {
  private cases = new Map<string, CaseRecord>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string | null) {}

  /** Load from disk and apply crash recovery. Returns human-readable recovery notes. */
  load(): string[] {
    if (!this.file || !fs.existsSync(this.file)) return [];
    const list = JSON.parse(fs.readFileSync(this.file, 'utf8')) as CaseRecord[];
    const notes: string[] = [];
    for (const c of list) {
      const note = recoverAfterRestart(c);
      if (note) notes.push(`${c.id}: ${note}`);
      this.cases.set(c.id, c);
    }
    if (notes.length) this.flush();
    return notes;
  }

  get(id: string) {
    return this.cases.get(id);
  }

  must(id: string): CaseRecord {
    const c = this.cases.get(id);
    if (!c) throw new HttpError(404, `case ${id} not found`);
    return c;
  }

  list(): CaseRecord[] {
    return [...this.cases.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  put(c: CaseRecord) {
    this.cases.set(c.id, c);
    this.saveSoon();
  }

  mutate(id: string, fn: (c: CaseRecord) => void): CaseRecord {
    const c = this.must(id);
    fn(c);
    c.updatedAt = now();
    this.saveSoon();
    return c;
  }

  reset() {
    this.cases.clear();
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
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.cases.values()]));
    fs.renameSync(tmp, this.file);
  }
}

export function newCaseRecord(lang: string): CaseRecord {
  const t = now();
  return {
    id: newId('case'),
    createdAt: t,
    updatedAt: t,
    state: 'NEW',
    lang,
    facts: [],
    evidence: [],
    messages: [],
    metrics: emptyMetrics(),
    stateHistory: [],
    llm: { contents: [] },
    fake: { analyzed: [] },
  };
}

/**
 * A restart (crash, or `tsx watch` reloading on save) kills any in-flight browser job.
 * - FILLING: nothing was submitted yet → safe to retry (NEEDS_USER)
 * - SUBMITTING / VERIFYING: the click may have gone through → UNKNOWN_RESULT (reconcile before anything else)
 * - APPROVED: the job never started and the approval secret may have rotated → re-approve
 */
export function recoverAfterRestart(c: CaseRecord): string | null {
  const move = (to: CaseState, reason: string) => {
    c.stateHistory.push({ from: c.state, to, reason, actor: 'system', at: now() });
    const from = c.state;
    c.state = to;
    return `${from} → ${to}`;
  };
  switch (c.state) {
    case 'FILLING':
      c.needsUser = { code: 'RESTARTED', reason: 'Server restarted while filling the form. Nothing was submitted; it is safe to retry.', resumeTo: 'FILLING' };
      return move('NEEDS_USER', 'server restarted during FILLING');
    case 'SUBMITTING':
    case 'VERIFYING':
      return move('UNKNOWN_RESULT', 'server restarted during submission — must reconcile before any retry');
    case 'APPROVED':
      c.approval = undefined;
      return move('READY_FOR_REVIEW', 'server restarted before the job started — re-approval required');
    default:
      return null;
  }
}
