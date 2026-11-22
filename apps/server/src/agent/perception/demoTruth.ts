import fs from 'node:fs';
import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true });
const truthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ticket'),
    ticketNumber: z.string().regex(/^9\d{8}$/),
    plateNumber: z.string().min(1),
    plateState: z.string().length(2),
    violationDescription: z.string().min(1),
    issuedAt: timestamp,
    location: z.string().min(1),
    fineAmount: z.number().nonnegative(),
  }),
  z.object({ kind: z.literal('sign'), text: z.string().min(1), visibility: z.enum(['clear', 'partially_obscured', 'not_visible']) }),
  z.object({ kind: z.literal('receipt'), plate: z.string().min(1), paidFrom: timestamp, paidUntil: timestamp }),
  /** a synthetic screenshot of a ticket-lookup results page (assistant demo) */
  z.object({
    kind: z.literal('ticket_list'),
    tickets: z
      .array(
        z.object({
          ticketNumber: z.string().regex(/^9\d{8}$/),
          amountDue: z.number().nonnegative(),
          violation: z.string().min(1),
          issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          plate: z.string().min(1),
          status: z.string().min(1),
        }),
      )
      .min(1),
  }),
]);

const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const keyword = Buffer.from('appealhero:truth\0', 'latin1');

/** Only the offline driver consumes the synthetic marker. Skip image data without decoding pixels. */
export function readDemoTruth(file: string) {
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, 8).equals(signature)) return;
  for (let pos = 8; pos + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(pos);
    const start = pos + 8;
    const end = start + size;
    if (end + 4 > bytes.length) return;
    const type = bytes.toString('ascii', pos + 4, start);
    if (type === 'IEND') return;
    if (type === 'tEXt' && size >= keyword.length && bytes.subarray(start, start + keyword.length).equals(keyword)) {
      if (size > 16_384) throw new Error('Oversized synthetic PNG metadata');
      return truthSchema.parse(JSON.parse(bytes.toString('latin1', start + keyword.length, end)));
    }
    pos = end + 4;
  }
}
