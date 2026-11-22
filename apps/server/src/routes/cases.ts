import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ADAPTER_VERSION,
  CIRCUMSTANCE_QUESTION,
  CIRCUMSTANCE_CHOICES,
  CircumstanceChoiceSchema,
  ApproveRequestSchema,
  ConfirmFactsRequestSchema,
  CreateCaseFieldsSchema,
  DecisionRequestSchema,
  SelectTicketRequestSchema,
  TicketQuerySchema,
  StatementEditRequestSchema,
  LANGS,
  isExecuting,
  type ChatMessage,
} from '@appealhero/shared';
import { config } from '../core/config';
import { approvalPreview, issueToken } from '../approval';
import { publishFacts, reportError, say, view, type Ctx } from '../core/ctx';
import { transition } from '../core/fsm';
import { serial, pendingUserTurn } from '../core/locks';
import { newCaseRecord } from '../core/store/cases';
import { HttpError, newId, now } from '../core/util';
import { appealAnyway, continueInvestigation, runExtraction } from '../agent/runtime';
import { pendingFactIds, upsertFact } from '../agent/policy/facts';
import { applyUserEdit, writeStatement } from '../agent/writer';
import { isCircumstanceKey, readChoices, recordChoices } from '../agent/runtime/circumstances';
import { investigate } from '../agent/runtime/investigate';
import { classifyViolation } from '../agent/rules/boston';
import { matchPlaybook } from '../agent/playbooks';
import { searchCase, chooseTicket } from '../agent/runtime/lookup';
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
    const choices = readChoices(parsed.circumstances);
    const ticket = files.find((f) => f.field === 'ticket');
    const query =
      parsed.mode === 'lookup'
        ? TicketQuerySchema.parse(
            parsed.ticketNumber ? { ticketNumber: parsed.ticketNumber } : { plate: parsed.plate, state: parsed.plateState ?? fields.state },
          )
        : undefined;
    if (query && ticket) throw new HttpError(400, 'Choose lookup or a ticket photo.');
    if (!query && !ticket) {
      if (parsed.mode === 'chat') throw new HttpError(501, `intake mode "${parsed.mode}" is not implemented yet (WP2)`);
      throw new HttpError(400, 'a ticket photo (field "ticket") is required');
    }
    const lang = fields.lang && fields.lang in LANGS ? fields.lang : 'zh';
    const c = newCaseRecord(lang);
    const ticketEv = ticket ? saveEvidence(c, ticket, 'ticket_photo') : undefined;
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
    if (query && fields.text?.trim())
      upsertFact(c, { key: 'userAccount', label: 'Your account', value: fields.text.trim(), provenance: 'USER_TEXT', status: 'USER_STATEMENT' });
    recordChoices(c, choices);
    ctx.store.put(c);
    if (parsed.circumstances === undefined) {
      const locale = c.lang === 'zh' || c.lang === 'es' ? c.lang : 'en';
      say(ctx, c.id, CIRCUMSTANCE_QUESTION[locale], {
        optional: true,
        multiple: true,
        options: CircumstanceChoiceSchema.options.map((id) => CIRCUMSTANCE_CHOICES[id].label[locale]),
        optionValues: [...CircumstanceChoiceSchema.options],
      });
    }
    ctx.hub.emit({ type: 'case.updated', caseId: c.id, state: c.state });
    if (query) void searchCase(ctx, c.id, query).catch((err) => reportError(ctx, c.id, err));
    else if (ticketEv) void runExtraction(ctx, c.id, { ticketId: ticketEv.id, audioId: audioEv?.id, text: fields.text });
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
    if (c.state === 'DRAFTING') throw new HttpError(409, 'Please wait for the draft before adding information.');
    const choices = readChoices(fields.circumstances);
    const choicesOnly = fields.circumstances !== undefined && !fields.text?.trim() && !fields.ticketNumber && !fields.plate && !files.length;
    if (choicesOnly && (!choices.length || c.state === 'IDENTIFYING' || c.state === 'NEW')) {
      if (choices.length) {
        ctx.store.mutate(id, (r) => {
          recordChoices(r, choices);
        });
        publishFacts(ctx, id);
      }
      return reply.code(202).send({ ok: true });
    }
    if (c.state === 'NEW' || c.state === 'IDENTIFYING') {
      if (!c.lookupResults) throw new HttpError(409, 'Please wait for ticket identification.');
      const query = TicketQuerySchema.parse(
        fields.ticketNumber || fields.text
          ? { ticketNumber: (fields.ticketNumber || fields.text).trim() }
          : { plate: fields.plate, state: fields.plateState ?? fields.state },
      );
      await searchCase(ctx, id, query);
      reply.code(202);
      return { ok: true };
    }
    const imageIds: string[] = [];
    let audioId: string | undefined;
    ctx.store.mutate(id, (r) => {
      for (const f of files.filter((x) => x.field === 'images' || x.field === 'image')) imageIds.push(saveEvidence(r, f, 'evidence_photo').id);
      const audio = files.find((x) => x.field === 'audio');
      if (audio) audioId = saveEvidence(r, audio, 'audio').id;
      const text = (fields.text ?? '').trim();
      if (text || imageIds.length)
        r.messages.push({ id: newId('m'), role: 'user', text: text || `📷 ${imageIds.length} photo(s)`, at: now(), evidenceIds: imageIds });
      if (!choicesOnly) r.pendingQuestion = undefined;
      r.metrics.userActiveMs += Math.max(0, Math.min(Number(fields.activeMs) || 0, 10 * 60_000));
    });
    ctx.hub.emit({ type: 'case.updated', caseId: id, state: ctx.store.must(id).state });
    void continueInvestigation(ctx, id, { text: (fields.text ?? '').trim(), evidenceIds: imageIds, audioId, choices });
    reply.code(202);
    return { ok: true };
  });

  // ---- gate 1: the user confirms / edits facts (the ONLY way a fact becomes CONFIRMED); done=true → DRAFTING ----
  app.post<IdParams>('/api/cases/:id/facts/confirm', async (req, reply) => {
    const id = req.params.id;
    const body = ConfirmFactsRequestSchema.parse(req.body ?? {});
    await pendingUserTurn(id);
    const c = ctx.store.must(id);
    if (isExecuting(c.state) || c.state === 'DRAFTING' || c.state === 'SUBMITTED' || c.state === 'FAILED')
      throw new HttpError(409, `cannot edit facts while ${c.state}`);
    if (body.done && c.state !== 'FACTS_REVIEW') throw new HttpError(409, `nothing to confirm in state ${c.state}`);
    const changed = c.facts.filter((f) => f.provenance !== 'RULE' && body.edits.some((e) => e.id === f.id && e.value.trim() !== f.value));
    for (const edit of body.edits) {
      const f = changed.find((f) => f.id === edit.id);
      if (!f) continue;
      if (['issuedAt', 'paidFrom', 'paidUntil'].includes(f.key) && !z.iso.datetime({ offset: true }).safeParse(edit.value.trim()).success)
        throw new HttpError(422, 'Enter a valid date and time with a time zone.');
      if (f.key === 'fineAmount' && (!edit.value.trim() || !Number.isFinite(Number(edit.value)) || Number(edit.value) < 0))
        throw new HttpError(422, 'Enter a valid fine amount.');
    }
    const reassess = changed.some(
      (f) =>
        !['fullName', 'email', 'mailingAddress'].includes(f.key) &&
        !isCircumstanceKey(f.key) &&
        !f.key.startsWith('revision') &&
        (f.key !== 'location' || c.facts.some((v) => v.key === 'duplicateNotice')),
    );
    ctx.store.mutate(id, (r) => {
      for (const fid of body.confirm) {
        const f = r.facts.find((x) => x.id === fid);
        if (f && f.status !== 'RULE_VERIFIED') f.status = 'CONFIRMED';
      }
      for (const e of body.edits) {
        const f = r.facts.find((x) => x.id === e.id);
        if (f && f.provenance !== 'RULE') {
          f.value = e.value.trim();
          if (r.ticket) {
            r.ticket = { ...r.ticket };
            switch (f.key) {
              case 'violation':
                r.ticket.violation = f.value;
                r.violationType = classifyViolation(f.value);
                r.playbookId = matchPlaybook(f.value)?.id;
                break;
              case 'ticketNumber':
              case 'location':
              case 'issuedAt':
                r.ticket[f.key] = f.value;
                break;
              case 'plateNumber':
                r.ticket.plate = f.value;
                break;
              case 'plateState':
                r.ticket = { ...r.ticket, state: f.value.toUpperCase() };
                break;
              case 'fineAmount':
                r.ticket.fine = Number(f.value);
                break;
            }
          }
          f.status = 'CONFIRMED';
          delete f.note;
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
    if (reassess && c.state === 'FACTS_REVIEW') {
      transition(ctx, id, 'INVESTIGATING', 'user', 'corrected facts require a new assessment', (r) => {
        r.triage = undefined;
        r.draft = undefined;
        r.approval = undefined;
        r.pendingQuestion = undefined;
        r.fake.awaiting = undefined;
        const duplicate = r.facts.find((f) => f.key === 'duplicateNotice');
        if (duplicate?.sourceRef) r.fake.analyzed = r.fake.analyzed.filter((id) => id !== duplicate.sourceRef);
        r.facts = r.facts.filter((f) => f.provenance !== 'RULE' && f.key !== 'duplicateNotice');
      });
      void serial(id, () => investigate(ctx, id, { kind: 'correction', keys: changed.map((f) => f.key) })).catch((err) => reportError(ctx, id, err));
      return reply.code(202).send(view(c));
    }
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
  app.post<IdParams>('/api/cases/:id/select-ticket', async (req, reply) => {
    const { ticketNumber } = SelectTicketRequestSchema.parse(req.body ?? {});
    await chooseTicket(ctx, req.params.id, ticketNumber);
    reply.code(202);
    return view(ctx.store.must(req.params.id));
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
    await pendingUserTurn(id);
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
