import type { FastifyInstance } from 'fastify';
import {
  ADAPTER_VERSION,
  ApproveRequestSchema,
  ConfirmFactsRequestSchema,
  CreateCaseFieldsSchema,
  DecisionRequestSchema,
  SelectTicketRequestSchema,
  StatementEditRequestSchema,
  LANGS,
  isExecuting,
  type ChatMessage,
} from '@appealhero/shared';
import { config } from '../core/config';
import { approvalPreview, issueToken } from '../approval';
import { publishFacts, view, type Ctx } from '../core/ctx';
import { transition } from '../core/fsm';
import { newCaseRecord } from '../core/store/cases';
import { HttpError, newId, now } from '../core/util';
import { appealAnyway, continueInvestigation, runExtraction } from '../agent/runtime';
import { pendingFactIds, upsertFact } from '../agent/policy/facts';
import { applyUserEdit, writeStatement } from '../agent/writer';
import { isExecBusy, runJob } from '../portal/runner';
import { readForm, saveEvidence } from './uploads';

type IdParams = { Params: { id: string } };

export function registerCaseRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- helpers (not frozen) ----
  app.get('/api/cases', async () => ctx.store.list().map(view));
  app.get<IdParams>('/api/cases/:id', async (req) => view(ctx.store.must(req.params.id)));
  app.get('/api/stream', (req, reply) => ctx.hub.serve(req, reply, '*'));

  // ---- FROZEN 1: create a case from a ticket photo (+ optional voice note / text) ----
  app.post('/api/cases', async (req, reply) => {
    const { fields, files } = await readForm(req);
    const parsed = CreateCaseFieldsSchema.parse(fields);
    const ticket = files.find((f) => f.field === 'ticket');
    if (!ticket) {
      if (parsed.mode === 'lookup' || parsed.mode === 'chat') throw new HttpError(501, `intake mode "${parsed.mode}" is not implemented yet (WP2)`);
      throw new HttpError(400, 'a ticket photo (field "ticket") is required');
    }
    const lang = fields.lang && fields.lang in LANGS ? fields.lang : 'zh';
    const c = newCaseRecord(lang);
    const ticketEv = saveEvidence(c, ticket, 'ticket_photo');
    const audio = files.find((f) => f.field === 'audio');
    const audioEv = audio ? saveEvidence(c, audio, 'audio') : undefined;
    // Saved profile values are typed by the user themselves → CONFIRMED with PROFILE provenance.
    const profile: [string, string, string | undefined][] = [
      ['fullName', 'Full name', fields.profileName],
      ['mailingAddress', 'Mailing address', fields.profileAddress],
      ['email', 'Email', fields.profileEmail],
    ];
    for (const [key, label, value] of profile)
      if (value?.trim()) upsertFact(c, { key, label, value: value.trim(), provenance: 'PROFILE', status: 'CONFIRMED' });
    if (fields.text || audioEv) {
      const msg: ChatMessage = {
        id: newId('m'),
        role: 'user',
        text: fields.text || '🎙 (voice note)',
        at: now(),
        evidenceIds: audioEv ? [audioEv.id] : undefined,
      };
      c.messages.push(msg);
    }
    c.metrics.userActiveMs += Math.max(0, Math.min(Number(fields.activeMs) || 0, 10 * 60_000));
    ctx.store.put(c);
    ctx.hub.emit({ type: 'case.updated', caseId: c.id, state: c.state });
    void runExtraction(ctx, c.id, { ticketId: ticketEv.id, audioId: audioEv?.id, text: fields.text });
    reply.code(202);
    return { caseId: c.id, jobId: c.id };
  });

  // ---- FROZEN 2: user reply (text / voice / photos) ----
  app.post<IdParams>('/api/cases/:id/messages', async (req, reply) => {
    const id = req.params.id;
    const c = ctx.store.must(id);
    if (isExecuting(c.state)) throw new HttpError(409, `the case is executing (${c.state}); wait for it to finish`);
    if (c.state === 'SUBMITTED' || c.state === 'FAILED') throw new HttpError(409, `the case is closed (${c.state})`);
    const { fields, files } = await readForm(req);
    const imageIds: string[] = [];
    let audioId: string | undefined;
    ctx.store.mutate(id, (r) => {
      for (const f of files.filter((x) => x.field === 'images' || x.field === 'image')) imageIds.push(saveEvidence(r, f, 'evidence_photo').id);
      const audio = files.find((x) => x.field === 'audio');
      if (audio) audioId = saveEvidence(r, audio, 'audio').id;
      const text = (fields.text ?? '').trim();
      if (text || imageIds.length)
        r.messages.push({ id: newId('m'), role: 'user', text: text || `📷 ${imageIds.length} photo(s)`, at: now(), evidenceIds: imageIds });
      r.pendingQuestion = undefined;
      r.metrics.userActiveMs += Math.max(0, Math.min(Number(fields.activeMs) || 0, 10 * 60_000));
    });
    ctx.hub.emit({ type: 'case.updated', caseId: id, state: ctx.store.must(id).state });
    void continueInvestigation(ctx, id, { text: (fields.text ?? '').trim(), evidenceIds: imageIds, audioId });
    reply.code(202);
    return { ok: true };
  });

  // ---- gate 1: the user confirms / edits facts (the ONLY way a fact becomes CONFIRMED); done=true → DRAFTING ----
  app.post<IdParams>('/api/cases/:id/facts/confirm', async (req, reply) => {
    const id = req.params.id;
    const body = ConfirmFactsRequestSchema.parse(req.body ?? {});
    const c = ctx.store.must(id);
    if (isExecuting(c.state) || c.state === 'SUBMITTED' || c.state === 'FAILED') throw new HttpError(409, `cannot edit facts while ${c.state}`);
    if (body.done && c.state !== 'FACTS_REVIEW') throw new HttpError(409, `nothing to confirm in state ${c.state}`);
    ctx.store.mutate(id, (r) => {
      for (const fid of body.confirm) {
        const f = r.facts.find((x) => x.id === fid);
        if (f && f.status !== 'RULE_VERIFIED') f.status = 'CONFIRMED';
      }
      for (const e of body.edits) {
        const f = r.facts.find((x) => x.id === e.id);
        if (f && f.provenance !== 'RULE') {
          f.value = e.value.trim();
          f.status = 'CONFIRMED';
          f.note = 'edited by the user';
          f.updatedAt = now();
        }
      }
    });
    publishFacts(ctx, id);
    // A fact changed after gate 1 → back through gate 1; the statement is rewritten and needs a fresh approval.
    if (body.edits.length && ctx.store.must(id).state === 'STATEMENT_REVIEW')
      transition(ctx, id, 'FACTS_REVIEW', 'user', 'user edited a fact — confirm, then the statement is rewritten', (r) => {
        r.approval = undefined;
      });
    const after = ctx.store.must(id);
    const pending = pendingFactIds(after);
    if (after.state === 'FACTS_REVIEW') {
      if (body.done) {
        if (pending.length) throw new HttpError(422, 'some facts are not confirmed yet', { unconfirmedFactIds: pending });
        transition(ctx, id, 'DRAFTING', 'user', 'user confirmed every fact — writing the statement');
        void writeStatement(ctx, id);
        reply.code(202);
        return view(ctx.store.must(id));
      }
      ctx.hub.emit({ type: 'facts.review', caseId: id, facts: after.facts, pendingFactIds: pending });
    }
    if (after.draft && after.state === 'STATEMENT_REVIEW') ctx.hub.emit({ type: 'review.ready', caseId: id, preview: approvalPreview(after) });
    return view(after);
  });

  // ---- v2 (A4): the user picks a ticket from the read-only lookup results ----
  app.post<IdParams>('/api/cases/:id/select-ticket', async (req) => {
    SelectTicketRequestSchema.parse(req.body ?? {});
    ctx.store.must(req.params.id);
    throw new HttpError(501, 'ticket lookup is not implemented yet (A4)');
  });

  // ---- v2: the user edits the statement directly (WP5 owns the writer; WP0 fixes the contract) ----
  app.put<IdParams>('/api/cases/:id/statement', async (req) => {
    const id = req.params.id;
    const body = StatementEditRequestSchema.parse(req.body ?? {});
    applyUserEdit(ctx, id, body);
    return view(ctx.store.must(id));
  });

  // ---- helper: negative-triage decision ----
  app.post<IdParams>('/api/cases/:id/decision', async (req, reply) => {
    const id = req.params.id;
    const { choice } = DecisionRequestSchema.parse(req.body ?? {});
    const c = ctx.store.must(id);
    if (choice === 'accept_pay') {
      transition(ctx, id, 'CLOSED_NO_APPEAL', 'user', 'user accepted the recommendation to pay');
      return view(ctx.store.must(id));
    }
    if (isExecuting(c.state)) throw new HttpError(409, `cannot change course while ${c.state}`);
    void appealAnyway(ctx, id);
    reply.code(202);
    return { ok: true };
  });

  // ---- FROZEN 3: approve the exact payload the user saw → signed one-time approval → start the executor ----
  app.post<IdParams>('/api/cases/:id/approve', async (req, reply) => {
    const id = req.params.id;
    const { payloadHash, activeMs } = ApproveRequestSchema.parse(req.body ?? {});
    const c = ctx.store.must(id);
    // Idempotent: a double tap on "approve" must not start two jobs.
    if (c.approval?.payloadHash === payloadHash && (isExecuting(c.state) || c.state === 'SUBMITTED')) return { jobId: id, state: c.state, idempotent: true };
    if (c.state !== 'STATEMENT_REVIEW') throw new HttpError(409, `cannot approve in state ${c.state} — confirm the facts and review the statement first`);
    const preview = approvalPreview(c);
    if (preview.missing.length || preview.unconfirmedFactIds.length)
      throw new HttpError(422, 'not ready for approval', { missing: preview.missing, unconfirmedFactIds: preview.unconfirmedFactIds });
    if (preview.payloadHash !== payloadHash)
      throw new HttpError(409, 'the content changed since you reviewed it — please review again', { currentHash: preview.payloadHash });
    if (isExecBusy(id)) throw new HttpError(409, 'A portal check is still running. Please retry approval in a moment.');
    const token = issueToken(config.approvalSecret, { caseId: id, payloadHash, adapterVersion: ADAPTER_VERSION, ttlMs: config.approvalTtlMs });
    transition(ctx, id, 'APPROVED', 'approval', `user approved payload ${payloadHash.slice(0, 12)}…`, (r) => {
      r.approval = {
        token: token.token,
        payload: preview.payload,
        statementUserLang: preview.statementUserLang,
        payloadHash,
        issuedAt: now(),
        expiresAt: token.expiresAt,
        attempts: 0,
      };
      r.metrics.userActiveMs += activeMs ?? 0;
    });
    ctx.audit.append({ caseId: id, type: 'approval', actor: 'user', data: { payloadHash, adapterVersion: ADAPTER_VERSION } });
    ctx.audit.flush();
    void runJob(ctx, id);
    reply.code(202);
    return { jobId: id, state: 'APPROVED', idempotent: false };
  });

  // ---- FROZEN 4: SSE stream (Last-Event-ID replay, 15 s heartbeat) ----
  app.get<IdParams>('/api/cases/:id/stream', (req, reply) => {
    ctx.store.must(req.params.id);
    ctx.hub.serve(req, reply, req.params.id);
  });
}
