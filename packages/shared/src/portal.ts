/**
 * Field spec shared by the mock portal and the Playwright adapter.
 * Field-faithful, NOT pixel-faithful: derived from the information boston.gov says an appeal needs
 * (name, mailing address, nature of dispute, plate + registration state, ticket number, evidence).
 * The real portal's actual form has not been inspected — do not call this a 1:1 replica.
 */
export const PORTAL_FIELD_SOURCE = 'https://www.boston.gov/departments/parking-clerk/how-appeal-parking-ticket';
export const PORTAL_ID = 'mock-boston-parking-appeal';
export const ADAPTER_VERSION = 'mock-boston@2026-11-21.1';

export const DISPUTE_REASON_KEYS = ['METER_NOT_IN_EFFECT', 'PAID', 'SIGNAGE', 'VEHICLE_INFO', 'PERMIT_DISPLAYED', 'OTHER'] as const;
export type DisputeReason = (typeof DISPUTE_REASON_KEYS)[number];
export const DISPUTE_REASONS: Record<DisputeReason, string> = {
  METER_NOT_IN_EFFECT: 'Meter rules were not in effect (Sunday, holiday, or outside meter hours)',
  PAID: 'I paid for parking (meter or ParkBoston app)',
  SIGNAGE: 'Signs were missing, unclear, or did not apply',
  VEHICLE_INFO: 'The ticket has wrong vehicle or plate information',
  PERMIT_DISPLAYED: 'I had a valid resident permit displayed',
  OTHER: 'Other',
};

export const PORTAL_FIELD_IDS = [
  'ticketNumber',
  'plateNumber',
  'plateState',
  'fullName',
  'mailingAddress',
  'email',
  'disputeReason',
  'statement',
] as const;
export type PortalFieldId = (typeof PORTAL_FIELD_IDS)[number];
export type PortalStep = 'start' | 'details';
export type FieldKind = 'text' | 'email' | 'select' | 'textarea';

export interface PortalField {
  id: PortalFieldId;
  /** Label on the classic (v1) portal — used by tier T1 (getByLabel, exact). */
  label: string;
  step: PortalStep;
  kind: FieldKind;
  maxLength?: number;
  /** Words a redesigned portal might use instead — used by fallback tiers and the Computer Use goal. */
  hints: string[];
}

export const PORTAL_FIELDS: readonly PortalField[] = [
  { id: 'ticketNumber', label: 'Ticket number', step: 'start', kind: 'text', maxLength: 12, hints: ['ticket', 'citation', 'violation number'] },
  { id: 'plateNumber', label: 'Plate number', step: 'start', kind: 'text', maxLength: 10, hints: ['plate', 'license'] },
  { id: 'plateState', label: 'Registration state', step: 'start', kind: 'select', hints: ['state', 'registration'] },
  { id: 'fullName', label: 'Full name', step: 'details', kind: 'text', maxLength: 80, hints: ['name'] },
  { id: 'mailingAddress', label: 'Mailing address', step: 'details', kind: 'textarea', maxLength: 200, hints: ['address', 'mailing'] },
  { id: 'email', label: 'Email', step: 'details', kind: 'email', maxLength: 120, hints: ['email', 'e-mail'] },
  { id: 'disputeReason', label: 'Reason for dispute', step: 'details', kind: 'select', hints: ['reason', 'dispute', 'why'] },
  { id: 'statement', label: 'Statement', step: 'details', kind: 'textarea', maxLength: 2000, hints: ['statement', 'what happened', 'explain'] },
];

export const fieldsForStep = (step: PortalStep) => PORTAL_FIELDS.filter((f) => f.step === step);

export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  OTHER: 'Other / outside the US',
};

export const EVIDENCE_LIMITS = {
  maxFiles: 5,
  maxBytes: 5 * 1024 * 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
};
