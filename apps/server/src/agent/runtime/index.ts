import { publishFacts, reportError, say, type Ctx } from '../../core/ctx';
import { transition } from '../../core/fsm';
import { serial } from '../../core/locks';
import { extractTicket, transcribeAudio } from '../perception';
import { upsertFact } from '../policy/facts';
import { investigate } from './investigate';
import { matchPlaybook } from '../playbooks';
import { classifyViolation } from '../rules/boston';
import { requestRevision } from '../writer';

/** Step 1: ticket photo (+voice/text) → facts → INVESTIGATING → first agent turn. */
async function runExtractionNow(ctx: Ctx, caseId: string, input: { ticketId: string; audioId?: string; text?: string }) {
  try {
    const c = ctx.store.must(caseId);
    const ticket = c.evidence.find((e) => e.id === input.ticketId);
    if (!ticket) throw new Error('ticket photo missing');
    transition(ctx, caseId, 'IDENTIFYING', 'system', 'reading the ticket');
    const audio = input.audioId ? c.evidence.find((e) => e.id === input.audioId) : undefined;
    const t0 = Date.now();
    const ext = await extractTicket(ctx, caseId, { ticket, audio, text: input.text, lang: c.lang });
    ctx.store.mutate(caseId, (r) => {
      r.extraction = ext;
      r.violationType = classifyViolation(ext.violationDescription);
      r.playbookId = matchPlaybook(ext.violationDescription)?.id;
      r.ticket = {
        ticketNumber: ext.ticketNumber,
        plate: ext.plateNumber,
        state: ext.plateState?.toUpperCase() ?? '',
        violation: ext.violationDescription,
        issuedAt: ext.issuedAt,
        location: ext.location,
        fine: ext.fineAmount,
        source: 'TICKET_OCR',
      };
      const ocr = (key: string, label: string, value: unknown) => {
        if (value !== undefined && value !== null && String(value).trim())
          upsertFact(r, { key, label, value: String(value).trim(), provenance: 'TICKET_OCR', status: 'NEEDS_CONFIRMATION', sourceRef: ticket.id });
      };
      ocr('ticketNumber', 'Ticket number', ext.ticketNumber);
      ocr('plateNumber', 'Plate number', ext.plateNumber);
      ocr('plateState', 'Registration state', ext.plateState?.toUpperCase());
      ocr('violation', 'Violation', ext.violationDescription);
      ocr('issuedAt', 'Issued at', ext.issuedAt);
      ocr('location', 'Location', ext.location);
      ocr('fineAmount', 'Fine (USD)', ext.fineAmount);
      if (ext.userStatement?.original)
        upsertFact(r, {
          key: 'userAccount',
          label: 'Your account',
          value: ext.userStatement.original,
          note: ext.userStatement.english,
          provenance: audio ? 'USER_VOICE' : 'USER_TEXT',
          status: 'USER_STATEMENT',
          sourceRef: audio?.id,
        });
      r.metrics.agentMs += Date.now() - t0;
    });
    publishFacts(ctx, caseId);
    transition(ctx, caseId, 'INVESTIGATING', 'system', `ticket ${ext.ticketNumber || '?'} identified (confidence ${ext.confidence}) — investigation started`);
    await investigate(ctx, caseId, { kind: 'start' });
  } catch (err) {
    reportError(ctx, caseId, err);
    const c = ctx.store.get(caseId);
    if (c && (c.state === 'NEW' || c.state === 'IDENTIFYING')) transition(ctx, caseId, 'FAILED', 'system', `extraction failed: ${(err as Error).message}`);
  }
}

/** Step 2: a user reply (text / voice / photos). In FACTS_REVIEW it sends the case back to INVESTIGATING;
 *  in STATEMENT_REVIEW it is a revision request for the writer. */
async function continueInvestigationNow(ctx: Ctx, caseId: string, input: { text: string; evidenceIds: string[]; audioId?: string }) {
  try {
    let text = input.text;
    const c = ctx.store.must(caseId);
    if (input.audioId) {
      const audio = c.evidence.find((e) => e.id === input.audioId);
      if (audio) {
        const t = await transcribeAudio(ctx, caseId, audio, c.lang);
        text = [text, t.original].filter(Boolean).join('\n');
        say(ctx, caseId, `🎙 ${t.original}`, { role: 'user', textEn: t.english });
      }
    }
    const state = ctx.store.must(caseId).state;
    if (state === 'STATEMENT_REVIEW') {
      if (text.trim()) requestRevision(ctx, caseId, text.trim());
      return;
    }
    if (state === 'FACTS_REVIEW' || state === 'NEEDS_USER' || state === 'CLOSED_NO_APPEAL')
      transition(ctx, caseId, 'INVESTIGATING', 'user', 'user added information', (r) => {
        r.approval = undefined;
      });
    await investigate(ctx, caseId, { kind: 'user', text, evidenceIds: input.evidenceIds });
  } catch (err) {
    reportError(ctx, caseId, err);
  }
}

async function appealAnywayNow(ctx: Ctx, caseId: string) {
  try {
    if (ctx.store.must(caseId).state === 'CLOSED_NO_APPEAL') transition(ctx, caseId, 'INVESTIGATING', 'user', 'user reopened the case');
    ctx.store.mutate(caseId, (r) => {
      r.triage = undefined;
      r.appealAnyway = true; // the user's explicit choice — the only way an OTHER appeal is allowed on a playbook ticket
    });
    await investigate(ctx, caseId, { kind: 'decision', choice: 'appeal_anyway' });
  } catch (err) {
    reportError(ctx, caseId, err);
  }
}

// Per-case single flight: a double-tapped "send" queues behind the running turn instead of interleaving
// two agent turns (which would scramble the Gemini history and fail the next call with a 400).
export const runExtraction = (ctx: Ctx, caseId: string, input: { ticketId: string; audioId?: string; text?: string }) =>
  serial(caseId, () => runExtractionNow(ctx, caseId, input));
export const continueInvestigation = (ctx: Ctx, caseId: string, input: { text: string; evidenceIds: string[]; audioId?: string }) =>
  serial(caseId, () => continueInvestigationNow(ctx, caseId, input));
export const appealAnyway = (ctx: Ctx, caseId: string) => serial(caseId, () => appealAnywayNow(ctx, caseId));
