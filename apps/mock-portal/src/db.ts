import { randomBytes } from 'node:crypto';
import { DEMO_TICKETS, type Scenario } from '@appealhero/shared';

export interface EvidenceFile {
  filename: string;
  bytes: number;
  sha256: string;
  mime: string;
}

export interface Session {
  sid: string;
  createdAt: number;
  data: Record<string, string>;
  evidence: EvidenceFile[];
}

/** Ground truth for tests: exactly what the "city" received. */
export interface Appeal {
  confirmationNumber: string;
  ticketNumber: string;
  plateNumber: string;
  plateState: string;
  fullName: string;
  mailingAddress: string;
  email: string;
  disputeReason: string;
  statement: string;
  extra: Record<string, string>;
  evidence: EvidenceFile[];
  createdAt: string;
}

export const db = {
  scenario: 'normal' as Scenario,
  /** timeout scenarios fire once, then behave normally (so a reconciled retry can succeed) */
  timeoutArmed: true,
  expiredTickets: new Set<string>(),
  sessions: new Map<string, Session>(),
  appeals: new Map<string, Appeal>(), // keyed by ticket number
  inbox: [] as { to: string; subject: string; confirmationNumber: string; at: string }[],
};

export function resetDb() {
  db.scenario = 'normal';
  db.timeoutArmed = true;
  db.expiredTickets.clear();
  db.sessions.clear();
  db.appeals.clear();
  db.inbox.length = 0;
}

export const newSid = () => randomBytes(8).toString('hex');
export const newConfirmation = () => `SIM-AP-${randomBytes(3).toString('hex').toUpperCase()}`;

/** Seeded demo tickets must match their plate; other 9xxxxxxxx tickets are accepted as synthetic. */
export function checkTicket(ticket: string, plate: string): string | null {
  if (!/^9\d{8}$/.test(ticket)) return 'Ticket numbers on this simulated portal start with 9 and have 9 digits.';
  const seeded = Object.values(DEMO_TICKETS).find((t) => t.ticketNumber === ticket);
  if (seeded && seeded.plateNumber.toUpperCase() !== plate.toUpperCase()) return 'The plate number does not match this ticket.';
  return null;
}
