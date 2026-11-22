/**
 * Synthetic demo tickets (ticket numbers 9xxxxxxxx are reserved for synthetic data).
 * The mock portal seeds these; the fake extractor returns them. Never use real tickets in tests.
 * 2026-11-15 is a Sunday → Boston meters are free (strong ground for the METER demo).
 */
export const DEMO_TICKETS = {
  meter: {
    ticketNumber: '900000001',
    plateNumber: '8KDW21',
    plateState: 'MA',
    violationDescription: 'METER FEE UNPAID',
    issuedAt: '2026-11-15T14:32:00-05:00',
    location: '700 Commonwealth Ave, Boston',
    fineAmount: 40,
  },
  permit: {
    ticketNumber: '900000002',
    plateNumber: 'KDT4821',
    plateState: 'NY',
    violationDescription: 'RESIDENT PERMIT ONLY',
    issuedAt: '2026-11-18T10:05:00-05:00',
    location: 'Bay State Rd, Boston',
    fineAmount: 60,
  },
  hydrant: {
    ticketNumber: '900000003',
    plateNumber: '5NB302',
    plateState: 'MA',
    violationDescription: 'HYDRANT',
    issuedAt: '2026-11-19T19:40:00-05:00',
    location: 'Beacon St, Boston',
    fineAmount: 100,
  },
} as const;
export type DemoTicketKey = keyof typeof DEMO_TICKETS;

export const isSyntheticTicket = (t: string) => /^9\d{8}$/.test(t);
