import { z } from 'zod';

/**
 * Free-form assistant (not a case): answers questions about Boston parking tickets, reads screenshots of the
 * official ticket-lookup results page that the USER captured, and explains a photo of a paper ticket. AppealHero never queries the official site itself
 * (its robots.txt disallows automated access and its terms forbid programmatic data extraction).
 */
export const OFFICIAL_TICKET_LOOKUP_URL = 'https://bostonma.rmcpay.com/';

export const AssistantTurnSchema = z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) });
export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;
export const AssistantHistorySchema = z.array(AssistantTurnSchema).max(40);

/** One row as printed on the results page; issueDate is normalised to YYYY-MM-DD. */
export const ListedTicketSchema = z.object({
  ticketNumber: z.string(),
  amountDue: z.number().nullable(),
  violation: z.string(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  plate: z.string(),
  status: z.string(),
});
export type ListedTicket = z.infer<typeof ListedTicketSchema>;

export const TicketCategorySchema = z.enum(['OPEN', 'PAID', 'APPEAL_PENDING', 'APPEAL_ACCEPTED', 'APPEAL_DENIED', 'OTHER']);
export type TicketCategory = z.infer<typeof TicketCategorySchema>;

/** Computed by code (never by the model): category, 21-day deadline and overdue flag for open tickets. */
export const AnalyzedTicketSchema = ListedTicketSchema.extend({
  category: TicketCategorySchema,
  deadline: z.string().optional(),
  daysLeft: z.number().optional(),
  overdue: z.boolean().optional(),
});
export type AnalyzedTicket = z.infer<typeof AnalyzedTicketSchema>;

export const TicketListAnalysisSchema = z.object({
  today: z.string(),
  tickets: z.array(AnalyzedTicketSchema),
  latest: AnalyzedTicketSchema.optional(),
  openCount: z.number(),
  totalDue: z.number(),
});
export type TicketListAnalysis = z.infer<typeof TicketListAnalysisSchema>;

/** A photo of a paper ticket, read as printed. Dates normalised to YYYY-MM-DD; amounts null when not printed. */
export const PhotoTicketSchema = z.object({
  ticketNumber: z.string(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  issueTime: z.string().optional(),
  plate: z.string(),
  plateState: z.string(),
  violation: z.string(),
  location: z.string(),
  amount: z.number().nullable(),
  /** "PAY BY" date printed on the ticket, when there is one */
  payBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** amount printed for after the pay-by date ("THEREAFTER") */
  lateAmount: z.number().nullable(),
});
export type PhotoTicket = z.infer<typeof PhotoTicketSchema>;

/** Computed by code: the printed pay-by date when present, otherwise ticket date + 21 days (boston.gov FAQ). */
export const AnalyzedPhotoTicketSchema = PhotoTicketSchema.extend({
  today: z.string(),
  deadline: z.string(),
  deadlineSource: z.enum(['printed', 'rule']),
  daysLeft: z.number(),
  overdue: z.boolean(),
});
export type AnalyzedPhotoTicket = z.infer<typeof AnalyzedPhotoTicketSchema>;

export const AssistantResponseSchema = z.object({
  reply: z.string(),
  analysis: TicketListAnalysisSchema.optional(),
  /** the uploaded image was a photo of a single paper ticket */
  photoTicket: AnalyzedPhotoTicketSchema.optional(),
  /** the uploaded image was neither a ticket-results page nor a ticket photo */
  notTicketList: z.boolean().optional(),
  sources: z.array(z.string()),
  aiMode: z.enum(['gemini', 'fake']),
});
export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;
