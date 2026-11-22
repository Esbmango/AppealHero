import { DEMO_TICKETS, type TicketInfo } from '@appealhero/shared';

type TicketStatus = NonNullable<TicketInfo['status']>;
import { db, type Appeal } from './db';

/**
 * Read-only ticket registry of the SIMULATED portal (synthetic data only, ticket numbers 9xxxxxxxx).
 * Open tickets come from DEMO_TICKETS; the closed history below exists only here so a plate search
 * looks like a real account (paid tickets, accepted appeals).
 */
export type PortalStatus = 'OPEN' | 'PAID' | 'APPEAL_ACCEPTED' | 'APPEAL_DENIED';

export interface PortalTicket {
  ticketNumber: string;
  plate: string;
  state: string;
  violation: string;
  code?: string;
  issuedAt: string;
  location: string;
  fine: number;
  status: PortalStatus;
}

/** Codes seen on the real portal's results list; other violations show no code. */
const CODES: Record<string, string> = { 'RESIDENT PERMIT ONLY': '334', 'OVER POSTED LIMIT': '339' };

const VIOLATION_TEXT: Record<string, string> = {
  'METER FEE UNPAID': 'Meter Fee Unpaid',
  'RESIDENT PERMIT ONLY': 'Resident Permit Only',
  HYDRANT: 'Hydrant',
  'STREET CLEANING': 'Street Cleaning',
  'NO STOPPING OR STANDING': 'No Stopping or Standing',
  'OVER POSTED LIMIT': 'Over Posted Limit',
};

const HISTORY: Omit<PortalTicket, 'code'>[] = [
  // María (8KDW21, MA): the plate-search demo account
  {
    ticketNumber: '980000011',
    plate: '8KDW21',
    state: 'MA',
    violation: 'OVER POSTED LIMIT',
    issuedAt: '2026-09-23T11:20:00-04:00',
    location: 'Newbury St, Boston',
    fine: 40,
    status: 'APPEAL_ACCEPTED',
  },
  {
    ticketNumber: '980000012',
    plate: '8KDW21',
    state: 'MA',
    violation: 'OVER POSTED LIMIT',
    issuedAt: '2026-09-15T16:45:00-04:00',
    location: 'Boylston St, Boston',
    fine: 40,
    status: 'PAID',
  },
  {
    ticketNumber: '980000013',
    plate: '8KDW21',
    state: 'MA',
    violation: 'RESIDENT PERMIT ONLY',
    issuedAt: '2026-09-02T08:05:00-04:00',
    location: 'Commonwealth Ave, Boston',
    fine: 60,
    status: 'PAID',
  },
  // Sam (5NB302, MA)
  {
    ticketNumber: '980000021',
    plate: '5NB302',
    state: 'MA',
    violation: 'STREET CLEANING',
    issuedAt: '2026-10-13T09:15:00-04:00',
    location: 'Marlborough St, Boston',
    fine: 40,
    status: 'PAID',
  },
  // Lin (KDT4821, NY): only reachable by ticket number or VIN — plate search is MA-only
  {
    ticketNumber: '980000031',
    plate: 'KDT4821',
    state: 'NY',
    violation: 'OVER POSTED LIMIT',
    issuedAt: '2026-10-06T13:30:00-04:00',
    location: 'Massachusetts Ave, Boston',
    fine: 40,
    status: 'APPEAL_DENIED',
  },
];

/** Synthetic VINs (17 characters, no I/O/Q) for the seeded vehicles. */
export const VINS: Record<string, string> = {
  '8KDW21': '1ZZDEMA0000000021',
  '5NB302': '1ZZDEMA0000000302',
  KDT4821: '1ZZDEMA0000004821',
  '7TRC55': '1ZZDEMA0000000055',
  '3MJX90': '1ZZDEMA0000000090',
};

const fromDemo = (): PortalTicket[] =>
  Object.values(DEMO_TICKETS).map((t) => ({
    ticketNumber: t.ticketNumber,
    plate: t.plateNumber,
    state: t.plateState,
    violation: t.violationDescription,
    issuedAt: t.issuedAt,
    location: t.location,
    fine: t.fineAmount,
    status: 'OPEN' as const,
  }));

export const allTickets = (): PortalTicket[] =>
  [...fromDemo(), ...HISTORY].map((t) => ({ ...t, code: CODES[t.violation] })).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));

export const findTicket = (n: string) => allTickets().find((t) => t.ticketNumber === n);

export const norm = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();

/** What a row shows after appeals filed on this portal are taken into account. */
export interface TicketView extends PortalTicket {
  appeal?: Appeal;
  /** shared TicketStatus for adapters: OPEN | PAID | APPEALED */
  machineStatus: TicketStatus;
  decision?: 'PENDING' | 'ACCEPTED' | 'DENIED';
  statusText: string;
  amountDue: number;
  violationText: string;
  canAppeal: boolean;
}

export function view(t: PortalTicket): TicketView {
  const appeal = db.appeals.get(t.ticketNumber);
  const violationText = `${t.code ? `${t.code} ` : ''}$${t.fine} ${VIOLATION_TEXT[t.violation] ?? t.violation}`;
  const base = { ...t, appeal, violationText };
  if (appeal) return { ...base, machineStatus: 'APPEALED', decision: 'PENDING', statusText: 'Appeal Pending', amountDue: t.fine, canAppeal: false };
  switch (t.status) {
    case 'PAID':
      return { ...base, machineStatus: 'PAID', statusText: 'Paid', amountDue: t.fine, canAppeal: false };
    case 'APPEAL_ACCEPTED':
      return { ...base, machineStatus: 'APPEALED', decision: 'ACCEPTED', statusText: 'Appeal Accepted', amountDue: 0, canAppeal: false };
    case 'APPEAL_DENIED':
      return { ...base, machineStatus: 'APPEALED', decision: 'DENIED', statusText: 'Appeal Denied', amountDue: t.fine, canAppeal: false };
    default:
      return { ...base, machineStatus: 'OPEN', statusText: 'Open', amountDue: t.fine, canAppeal: true };
  }
}

export type LookupMessage = 'missing_query' | 'plate_lookup_ma_only' | 'not_found';
export interface LookupQuery {
  ticketNumber?: string;
  plate?: string;
  state?: string;
  vin?: string;
}
export interface LookupResult {
  kind: 'ticket' | 'plate' | 'vin' | 'none';
  tickets: TicketView[];
  message?: LookupMessage;
}

/** Read-only. Plate search is Massachusetts-only (boston.gov, how-pay-parking-ticket); other states use a ticket number. */
export function lookup(q: LookupQuery): LookupResult {
  const ticketNumber = (q.ticketNumber ?? '').trim();
  const plate = norm(q.plate ?? '');
  const state = (q.state ?? '').trim().toUpperCase();
  const vin = norm(q.vin ?? '');
  const out = (kind: LookupResult['kind'], list: PortalTicket[]): LookupResult => {
    const tickets = list.map(view);
    return tickets.length ? { kind, tickets } : { kind, tickets, message: 'not_found' };
  };
  if (ticketNumber)
    return out(
      'ticket',
      allTickets().filter((t) => t.ticketNumber === ticketNumber),
    );
  if (plate) {
    if (state && state !== 'MA') return { kind: 'plate', tickets: [], message: 'plate_lookup_ma_only' };
    return out(
      'plate',
      allTickets().filter((t) => norm(t.plate) === plate && t.state === 'MA'),
    );
  }
  if (vin) {
    const plates = Object.entries(VINS)
      .filter(([, v]) => v === vin)
      .map(([p]) => p);
    return out(
      'vin',
      allTickets().filter((t) => plates.includes(t.plate)),
    );
  }
  return { kind: 'none', tickets: [], message: 'missing_query' };
}
