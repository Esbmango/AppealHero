import type { Ctx } from '../../core/ctx';
import { reportError, publishFacts, say } from '../../core/ctx';
import { serial } from '../../core/locks';
import { HttpError } from '../../core/util';
import { transition } from '../../core/fsm';
import type { TicketQuery } from '@appealhero/shared';
import { runTool } from '../tools';
import { readPersonalStatement } from './circumstances';
import { transcribeAudio } from '../perception';
import { upsertFact } from '../policy/facts';
import { investigate } from './investigate';

export function searchCase(ctx: Ctx, id: string, query: TicketQuery) {
  return serial(id, async () => {
    const c = ctx.store.must(id);
    if (c.state === 'NEW') transition(ctx, id, 'IDENTIFYING', 'system', 'searching the simulated portal');
    if (c.state !== 'IDENTIFYING') throw new HttpError(409, 'Ticket selection has already finished.');
    const out = await runTool(ctx, id, 'lookup_tickets', query);
    if (out.isError) {
      reportError(ctx, id, 'Ticket lookup could not be completed.');
      transition(ctx, id, 'FAILED', 'system', 'simulated portal lookup failed');
    }
  });
}
export function chooseTicket(ctx: Ctx, id: string, ticketNumber: string) {
  return serial(id, async () => {
    const c = ctx.store.must(id);
    if (c.ticket?.source === 'PORTAL_LOOKUP' && c.ticket.ticketNumber === ticketNumber) return;
    if (c.state !== 'IDENTIFYING') throw new HttpError(409, 'This case is not awaiting ticket selection.');
    const out = await runTool(ctx, id, 'select_ticket', { ticketNumber }, ticketNumber);
    if (out.isError) throw new HttpError(422, 'Select an open ticket from the current results.');
    const account = c.facts.find((f) => f.key === 'userAccount');
    if (account) ctx.store.mutate(id, (r) => readPersonalStatement(r, account.value, 'USER_TEXT'));
    void serial(id, async () => {
      const audio = c.evidence.find((e) => e.kind === 'audio');
      if (audio) {
        try {
          const transcript = await transcribeAudio(ctx, id, audio, c.lang);
          say(ctx, id, transcript.original, { role: 'user', textEn: transcript.english });
          ctx.store.mutate(id, (r) => {
            upsertFact(r, {
              key: 'voiceAccount',
              label: 'Voice account',
              value: transcript.original,
              note: transcript.english,
              provenance: 'USER_VOICE',
              status: 'USER_STATEMENT',
              sourceRef: audio.id,
            });
            readPersonalStatement(r, transcript.original, 'USER_VOICE');
          });
        } catch (err) {
          reportError(ctx, id, err);
        }
      }
      publishFacts(ctx, id);
      await investigate(ctx, id, { kind: 'start' });
    }).catch((err) => reportError(ctx, id, err));
  });
}
