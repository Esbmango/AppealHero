/**
 * Review hardening (GPT P0.2 / Gemini P0-1, P0-2): durable state changes and per-case single flight.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaseStore, newCaseRecord } from '../src/core/store/cases';
import { JsonUserRepo } from '../src/core/store/users';
import { JsonAuditRepo, verifyChain } from '../src/core/store/audit';
import { EventHub } from '../src/core/hub';
import { transition } from '../src/core/fsm';
import { exclusive, serial } from '../src/core/locks';
import type { Ctx } from '../src/core/ctx';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tempCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appealhero-hard-'));
  const file = path.join(dir, 'cases.json');
  const ctx: Ctx = { store: new CaseStore(file), hub: new EventHub(), users: new JsonUserRepo(null), audit: new JsonAuditRepo(null) };
  return { ctx, file };
}

describe('durable state changes', () => {
  it('a submit attempt is on disk before the click (no 50 ms write window)', () => {
    const { ctx, file } = tempCtx();
    const c = newCaseRecord('zh');
    c.state = 'FILLING';
    ctx.store.put(c);
    transition(ctx, c.id, 'SUBMITTING', 'executor', 'read-back verified', (r) => {
      r.submission = { attemptId: 'sub_test', payloadHash: 'a'.repeat(64), startedAt: new Date().toISOString() };
    });
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { id: string; state: string; submission?: { attemptId: string } }[];
    expect(onDisk.find((x) => x.id === c.id)).toMatchObject({ state: 'SUBMITTING', submission: { attemptId: 'sub_test' } });
  });

  it('after a crash mid-submit the case comes back as UNKNOWN_RESULT, never as safe to retry', () => {
    const { ctx, file } = tempCtx();
    const c = newCaseRecord('zh');
    c.state = 'FILLING';
    ctx.store.put(c);
    transition(ctx, c.id, 'SUBMITTING', 'executor', 'read-back verified');
    const restarted = new CaseStore(file);
    const notes = restarted.load();
    expect(restarted.must(c.id).state).toBe('UNKNOWN_RESULT');
    expect(notes.join(' ')).toContain('SUBMITTING → UNKNOWN_RESULT');
  });

  it('every transition is appended to a verifiable audit chain', () => {
    const { ctx } = tempCtx();
    const c = newCaseRecord('zh');
    c.state = 'FILLING';
    ctx.store.put(c);
    transition(ctx, c.id, 'SUBMITTING', 'executor', 'a');
    transition(ctx, c.id, 'VERIFYING', 'executor', 'b');
    const chain = ctx.audit.list(c.id);
    expect(chain).toHaveLength(2);
    expect(verifyChain(chain)).toEqual({ ok: true });
    chain[0] = { ...chain[0], data: { from: 'FILLING', to: 'SUBMITTED', reason: 'tampered' } };
    expect(verifyChain(chain)).toEqual({ ok: false, brokenAt: 1 });
  });
});

describe('per-case single flight', () => {
  it('agent turns for one case run one after another, never interleaved', async () => {
    const log: string[] = [];
    const turn = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await sleep(ms);
      log.push(`${name}:end`);
    };
    await Promise.all([serial('case_a', turn('first', 30)), serial('case_a', turn('second', 1)), serial('case_b', turn('other', 1))]);
    const a = log.filter((l) => !l.startsWith('other'));
    expect(a).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('a failing turn does not block the next one', async () => {
    const out: string[] = [];
    await serial('case_c', async () => {
      throw new Error('boom');
    }).catch(() => out.push('failed'));
    await serial('case_c', async () => {
      out.push('ran');
    });
    expect(out).toEqual(['failed', 'ran']);
  });

  it('a second executor/reconcile on the same case is refused while one is running', async () => {
    let inner: boolean | undefined;
    const outer = await exclusive('case_d', async () => {
      inner = await exclusive('case_d', async () => {});
    });
    expect(outer).toBe(true);
    expect(inner).toBe(false);
  });
});
