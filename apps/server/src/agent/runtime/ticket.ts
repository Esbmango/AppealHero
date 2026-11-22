import type { TicketInfo } from '@appealhero/shared';
import type { CaseRecord } from '../../core/types';
import { upsertFact } from '../policy/facts';
import { matchPlaybook } from '../playbooks';
import { classifyViolation } from '../rules/boston';

export function identifyTicket(c: CaseRecord, ticket: TicketInfo, sourceRef: string) {
  c.ticket = ticket;
  c.violationType = classifyViolation(ticket.violation);
  c.playbookId = matchPlaybook(ticket.violation)?.id;
  const values = [
    ['ticketNumber', 'Ticket number', ticket.ticketNumber],
    ['plateNumber', 'Plate number', ticket.plate],
    ['plateState', 'Registration state', ticket.state],
    ['violation', 'Violation', ticket.violation],
    ['issuedAt', 'Issued at', ticket.issuedAt],
    ['location', 'Location', ticket.location],
    ['fineAmount', 'Fine (USD)', ticket.fine],
  ] as const;
  for (const [key, label, value] of values) {
    if (value !== undefined && String(value).trim())
      upsertFact(c, { key, label, value: String(value).trim(), provenance: ticket.source, status: 'NEEDS_CONFIRMATION', sourceRef });
  }
}
