import type { PersonaId } from './schemas';

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
  // v2 additions (playbooks boston.street_cleaning / boston.no_stopping — golden tests, not the main demo)
  streetCleaning: {
    ticketNumber: '900000004',
    plateNumber: '7TRC55',
    plateState: 'MA',
    violationDescription: 'STREET CLEANING',
    issuedAt: '2026-11-10T09:10:00-05:00', // 2nd Tuesday of November
    location: 'Marlborough St, Boston',
    fineAmount: 40,
  },
  noStopping: {
    ticketNumber: '900000005',
    plateNumber: '3MJX90',
    plateState: 'MA',
    violationDescription: 'NO STOPPING OR STANDING',
    issuedAt: '2026-11-17T08:15:00-05:00',
    location: 'Boylston St, Boston',
    fineAmount: 90,
  },
} as const;
export type DemoTicketKey = keyof typeof DEMO_TICKETS;

export const isSyntheticTicket = (t: string) => /^9\d{8}$/.test(t);

/** Demo personas (all synthetic). Each maps to one main-path ticket — see docs/PRODUCT_SPEC.md §3. */
export const DEMO_PERSONAS: Record<
  PersonaId,
  {
    name: string;
    lang: 'zh' | 'es' | 'en';
    mailingAddress: string;
    email: string;
    vehicles: { plate: string; state: string; make: string; color: string }[];
    ticket: DemoTicketKey;
  }
> = {
  lin: {
    name: 'Lin Xiaoyu',
    lang: 'zh',
    mailingAddress: '100 Example Ave, Apt 2, Boston, MA 02215',
    email: 'lin.demo@example.com',
    vehicles: [{ plate: 'KDT4821', state: 'NY', make: 'Toyota', color: 'Silver' }],
    ticket: 'permit',
  },
  maria: {
    name: 'María González',
    lang: 'es',
    mailingAddress: '200 Example St, Boston, MA 02118',
    email: 'maria.demo@example.com',
    vehicles: [{ plate: '8KDW21', state: 'MA', make: 'Honda', color: 'Blue' }],
    ticket: 'meter',
  },
  sam: {
    name: 'Sam Carter',
    lang: 'en',
    mailingAddress: '300 Example Rd, Boston, MA 02116',
    email: 'sam.demo@example.com',
    vehicles: [{ plate: '5NB302', state: 'MA', make: 'Ford', color: 'Black' }],
    ticket: 'hydrant',
  },
};
