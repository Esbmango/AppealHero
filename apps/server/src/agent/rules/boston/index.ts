/**
 * Deterministic Boston rules. The LLM decides WHICH rule to run; code computes the answer and cites the source.
 * Sources were read on 2026-11-21 — re-check before relying on them.
 */
export const RULE_SOURCES = {
  meterHours: 'https://www.boston.gov/contact/parking-clerk', // meters operate Mon–Sat 8 a.m.–8 p.m.
  meterFreeDays: 'https://www.boston.gov/departments/parking-clerk/parking-ticket-faqs', // free on Sundays and citywide holidays
  holidays: 'https://www.boston.gov/departments/311/city-boston-holidays',
  deadline: 'https://www.boston.gov/departments/parking-clerk/parking-ticket-faqs', // 21 days to pay or appeal
  fines: 'https://www.boston.gov/departments/parking-clerk/parking-ticket-fines-and-codes',
  videoHearing: 'https://www.boston.gov/departments/parking-clerk/how-appeal-parking-ticket',
  plateLookup: 'https://www.boston.gov/departments/parking-clerk/how-pay-parking-ticket',
} as const;

export type ViolationType = 'METER' | 'RESIDENT_PERMIT' | 'STREET_CLEANING' | 'HYDRANT' | 'NO_STOPPING' | 'OTHER';

export const FINES: Partial<Record<ViolationType, { fine: number; late: number }>> = {
  METER: { fine: 40, late: 8 },
  RESIDENT_PERMIT: { fine: 60, late: 13 },
  STREET_CLEANING: { fine: 40, late: 13 },
  HYDRANT: { fine: 100, late: 33 },
  NO_STOPPING: { fine: 90, late: 25 },
};

/** City of Boston holidays on which meters are free (Juneteenth 2027: "Sunday parking rules"). */
export const BOSTON_HOLIDAYS: Record<string, string> = {
  '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day",
  '2027-01-18': 'Martin Luther King, Jr. Day',
  '2027-02-15': 'Presidents Day',
  '2027-03-17': 'Evacuation Day',
  '2027-04-19': 'Patriots Day',
  '2027-05-31': 'Memorial Day',
  '2027-06-17': 'Bunker Hill Day',
  '2027-06-18': 'Juneteenth (Observed)',
  '2027-07-05': 'Independence Day (Observed)',
  '2027-09-06': 'Labor Day',
  '2027-10-11': 'Indigenous Peoples Day',
  '2027-11-11': 'Veterans Day',
  '2027-11-25': 'Thanksgiving Day',
  '2027-12-24': 'Christmas Day (Observed)',
};

/** Exact descriptions from the official fines table (checked 2026-11-21). Same category ≠ same fine (e.g. out-of-order meter is $25). */
export const FINE_TABLE: Record<string, { fine: number; late: number }> = {
  'METER FEE UNPAID': { fine: 40, late: 8 },
  'OVER METER LIMIT': { fine: 40, late: 8 },
  'METER VIOLATION (OUT OF ORDER)': { fine: 25, late: 8 },
  'NOT IN METERED SPACE': { fine: 25, late: 8 },
  'RESIDENT PERMIT ONLY': { fine: 60, late: 13 },
  'NO VALID RESIDENT PARKING PERMIT/STICKER': { fine: 100, late: 33 },
  'STREET CLEANING': { fine: 40, late: 13 },
  'OVERNIGHT STREET CLEANING (NO TOW)': { fine: 90, late: 30 },
  HYDRANT: { fine: 100, late: 33 },
  'NO STOPPING OR STANDING': { fine: 90, late: 25 },
  'NO PARKING (ZONE A)': { fine: 90, late: 18 },
  'NO PARKING (ZONE B)': { fine: 55, late: 8 },
};
const normDesc = (d: string) => d.toUpperCase().replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();

/** Never guess: the printed amount wins; then the exact official description; the category is only a labelled estimate. */
export function fineFor(description?: string, printed?: number, category?: string): { fine?: number; late?: number; basis?: 'ticket' | 'table' | 'category' } {
  const row = description ? FINE_TABLE[normDesc(description)] : undefined;
  if (printed !== undefined && Number.isFinite(printed) && printed > 0) return { fine: printed, late: row?.late, basis: 'ticket' };
  if (row) return { ...row, basis: 'table' };
  const cat = category ? FINES[category as ViolationType] : undefined;
  return cat ? { ...cat, basis: 'category' } : {};
}

export function classifyViolation(desc: string): ViolationType {
  const d = desc.toLowerCase();
  if (/meter/.test(d)) return 'METER';
  if (/resident|permit/.test(d)) return 'RESIDENT_PERMIT';
  if (/street clean|sweep/.test(d)) return 'STREET_CLEANING';
  if (/hydrant/.test(d)) return 'HYDRANT';
  if (/no stopping|no standing/.test(d)) return 'NO_STOPPING';
  return 'OTHER';
}

export function bostonParts(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${iso}`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { weekday: parts.weekday, ymd: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function formatBoston(iso: string, lang = 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' }).format(d);
}

export const RULE_NAMES = [
  'meter_hours_in_effect',
  'meter_free_day',
  'receipt_covers_ticket',
  'appeal_deadline',
  'fine_amount',
  'video_hearing_eligibility',
  'online_plate_lookup',
] as const;
export type RuleName = (typeof RULE_NAMES)[number];

export const RULE_LABELS: Record<RuleName, string> = {
  meter_hours_in_effect: 'Meter hours check',
  meter_free_day: 'Sunday / City holiday check',
  receipt_covers_ticket: 'Payment covers ticket time',
  appeal_deadline: 'Appeal deadline',
  fine_amount: 'Fine and late penalty',
  video_hearing_eligibility: 'Video hearing eligibility',
  online_plate_lookup: 'Online plate lookup',
};

export interface RuleInput {
  issuedAt?: string;
  /** the violation text printed on the ticket */
  violationDescription?: string;
  /** the fine printed on the ticket (authoritative when present) */
  printedFine?: number;
  paidUntil?: string;
  paidFrom?: string;
  receiptPlate?: string;
  ticketPlate?: string;
  violationType?: string;
  plateState?: string;
  isMaResident?: boolean;
  hasPlacard?: boolean;
  over65?: boolean;
}

export interface RuleResult {
  rule: RuleName;
  result: boolean | number | string | null;
  detail: string;
  source: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const req = (v: string | undefined, name: string) => {
  if (!v) throw new Error(`rule input "${name}" is missing`);
  return v;
};

// Dates reflect the source review recorded in docs/PLAYBOOKS.md §8. The receipt check is an evidence calculation.
export const RULE_METADATA = {
  meter_hours_in_effect: { source: RULE_SOURCES.meterHours, checkedAt: '2026-11-21', verified: true },
  meter_free_day: { source: RULE_SOURCES.meterFreeDays, checkedAt: '2026-11-21', verified: true },
  receipt_covers_ticket: { source: 'payment receipt and ticket timestamps', checkedAt: '2026-11-21', verified: true },
  appeal_deadline: { source: RULE_SOURCES.deadline, checkedAt: '2026-11-21', verified: true },
  fine_amount: { source: RULE_SOURCES.fines, checkedAt: '2026-11-21', verified: true },
  video_hearing_eligibility: { source: RULE_SOURCES.videoHearing, checkedAt: '2026-11-21', verified: true },
  online_plate_lookup: { source: RULE_SOURCES.plateLookup, checkedAt: '2026-11-21', verified: true },
} satisfies Record<RuleName, { source: string; checkedAt: string; verified: boolean }>;

export function runRule(name: RuleName, input: RuleInput) {
  return { ...RULE_METADATA[name], ...calculateRule(name, input) };
}

function calculateRule(name: RuleName, input: RuleInput): RuleResult {
  switch (name) {
    case 'meter_hours_in_effect': {
      const p = bostonParts(req(input.issuedAt, 'issuedAt'));
      const holiday = BOSTON_HOLIDAYS[p.ymd];
      const inEffect = p.weekday !== 'Sun' && !holiday && p.hour >= 8 && p.hour < 20;
      const when = `${p.weekday} ${p.ymd} ${pad(p.hour)}:${pad(p.minute)}`;
      return {
        rule: name,
        result: inEffect,
        detail: inEffect
          ? `Meters were in operation at ${when}`
          : `Meters were not in operation at ${when} (they run Mon–Sat 8 a.m.–8 p.m. and are free on Sundays and City holidays)`,
        source: holiday ? RULE_SOURCES.holidays : RULE_SOURCES.meterHours,
      };
    }
    case 'meter_free_day': {
      const p = bostonParts(req(input.issuedAt, 'issuedAt'));
      const holiday = BOSTON_HOLIDAYS[p.ymd];
      const free = p.weekday === 'Sun' || Boolean(holiday);
      return {
        rule: name,
        result: free,
        detail: free ? `${p.ymd} was ${holiday ?? 'a Sunday'} — Boston meters are free that day` : `${p.ymd} was not a Sunday or City holiday`,
        source: holiday ? RULE_SOURCES.holidays : RULE_SOURCES.meterFreeDays,
      };
    }
    case 'receipt_covers_ticket': {
      const issued = new Date(req(input.issuedAt, 'issuedAt'));
      const until = new Date(req(input.paidUntil, 'paidUntil'));
      const from = input.paidFrom ? new Date(input.paidFrom) : null;
      const mismatch = input.receiptPlate && input.ticketPlate && input.receiptPlate.toUpperCase() !== input.ticketPlate.toUpperCase();
      const covers = !mismatch && until >= issued && (!from || from <= issued);
      return {
        rule: name,
        result: covers,
        detail: mismatch
          ? 'The receipt shows a different plate from the ticket.'
          : `Paid ${from ? `from ${formatBoston(from.toISOString())} ` : ''}until ${formatBoston(until.toISOString())}; ticket issued ${formatBoston(issued.toISOString())} → ${covers ? 'covered' : 'not covered'}`,
        source: 'computed from the payment receipt photo',
      };
    }
    case 'appeal_deadline': {
      const issued = new Date(req(input.issuedAt, 'issuedAt'));
      const deadline = new Date(issued.getTime() + 21 * 86_400_000);
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
      return {
        rule: name,
        result: deadline.toISOString(),
        detail: `Pay or appeal within 21 days: by ${formatBoston(deadline.toISOString())} (${daysLeft >= 0 ? `${daysLeft} days left` : 'overdue — a late fee is added, appeal still possible'})`,
        source: RULE_SOURCES.deadline,
      };
    }
    case 'fine_amount': {
      const f = fineFor(input.violationDescription, input.printedFine, input.violationType);
      return {
        rule: name,
        result: f.fine ?? null,
        detail:
          f.fine === undefined
            ? 'Unknown fine — check the amount printed on the ticket'
            : `fine $${f.fine}${f.late !== undefined ? `, late penalty $${f.late}` : ''} (${f.basis === 'ticket' ? 'as printed on the ticket' : f.basis === 'table' ? 'official fines table' : 'category estimate — check the ticket'})`,
        source: RULE_SOURCES.fines,
      };
    }
    case 'video_hearing_eligibility': {
      const nonMa = Boolean(input.plateState && input.plateState !== 'MA' && input.isMaResident === false);
      const eligible = nonMa || Boolean(input.hasPlacard) || Boolean(input.over65);
      return {
        rule: name,
        result: eligible,
        detail: eligible
          ? 'Eligible to request a video-call hearing (non-MA vehicle and non-resident, disability placard, or over 65)'
          : 'Not eligible for a video-call hearing based on the facts given',
        source: RULE_SOURCES.videoHearing,
      };
    }
    case 'online_plate_lookup': {
      const ok = input.plateState === 'MA';
      return {
        rule: name,
        result: ok,
        detail: ok
          ? 'MA plates can be looked up online by plate number'
          : 'Only MA-registered plates can be looked up online by plate — use the ticket number instead',
        source: RULE_SOURCES.plateLookup,
      };
    }
  }
}
