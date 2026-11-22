import { defineTool, SelectTicketRequestSchema, TicketQuerySchema } from '@appealhero/shared';
import { lookupTickets } from '../../portal/runner';
import { publishFacts, say } from '../../core/ctx';
import { transition } from '../../core/fsm';
import { identifyTicket } from '../runtime/ticket';
import type { ToolCtx } from './types';

const copy = {
  en: {
    plate_lookup_ma_only: 'Only Massachusetts plates can be searched. Enter the ticket number.',
    not_found: 'No tickets matched. Check the number and try again.',
    select: 'Choose an open ticket to review.',
    closed: 'These tickets are already paid or appealed. You can search for another ticket number.',
  },
  zh: {
    plate_lookup_ma_only: '只有马萨诸塞州车牌支持按车牌查询。请输入罚单号。',
    not_found: '没有找到匹配的罚单。请核对罚单号后重试。',
    select: '请选择一张未结清的罚单。',
    closed: '这些罚单均已缴费或已提出申诉。你可以输入其他罚单号。',
  },
  es: {
    plate_lookup_ma_only: 'Solo se pueden buscar placas de Massachusetts. Introduce el número de multa.',
    not_found: 'No hay coincidencias. Comprueba el número de multa y vuelve a intentarlo.',
    select: 'Elige una multa abierta para revisarla.',
    closed: 'Estas multas ya se pagaron o se apelaron. Puedes buscar otro número.',
  },
};
export const lookupTicketsTool = defineTool<ToolCtx, typeof TicketQuerySchema>({
  name: 'lookup_tickets',
  stages: ['IDENTIFYING'],
  params: TicketQuerySchema,
  description: 'Read-only search of the simulated portal by ticket number or MA plate. Always let the user choose.',
  async run({ ctx, caseId }, query) {
    const c = ctx.store.must(caseId);
    const result = await lookupTickets(ctx, caseId, query);
    const labels = copy[c.lang as keyof typeof copy] ?? copy.en;
    ctx.store.mutate(caseId, (r) => {
      r.lookupResults = result.tickets;
      r.lookupMessage = result.message;
    });
    ctx.store.flush();
    ctx.hub.emit({ type: 'lookup.results', caseId, ...result });
    say(ctx, caseId, labels[result.message ?? (result.tickets.some((t) => t.status === 'OPEN') ? 'select' : 'closed')]);
    return { result, endTurn: true };
  },
});
export const selectTicketTool = defineTool<ToolCtx, typeof SelectTicketRequestSchema>({
  name: 'select_ticket',
  stages: ['IDENTIFYING'],
  params: SelectTicketRequestSchema,
  description: 'Use the ticket explicitly chosen by the user from the latest search.',
  run({ ctx, caseId, selectedByUser }, { ticketNumber }) {
    const result = ctx.store.must(caseId).lookupResults?.find((t) => t.ticketNumber === ticketNumber);
    if (selectedByUser !== ticketNumber || result?.status !== 'OPEN')
      return { result: { error: 'Select an open ticket from the current results.' }, isError: true };
    transition(ctx, caseId, 'INVESTIGATING', 'agent', 'user selected a ticket from the simulated portal', (c) => {
      identifyTicket(c, result, result.ticketNumber);
      c.pendingQuestion = undefined;
    });
    publishFacts(ctx, caseId);
    return { result: { ticketNumber }, endTurn: true };
  },
});
