import { z } from 'zod';
import { TicketInfoSchema, type TicketQuery } from '@appealhero/shared';
import type { Page } from 'playwright';

export async function readLookup(page: Page, base: string, query: TicketQuery) {
  const url = new URL('/lookup', base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await page.goto(url.href);
  if (!response?.ok()) throw new Error('Ticket lookup unavailable');
  const list = page.locator('[data-lookup-results]');
  await list.waitFor({ state: 'attached' });
  const rows = await list.locator('[data-ticket-row]').evaluateAll((elements) => elements.map((el) => ({ ...(el as HTMLElement).dataset })));
  const tickets = rows.map((d) =>
    TicketInfoSchema.parse({
      ticketNumber: d.ticketNumber,
      plate: d.plate,
      state: d.state,
      violation: d.violation,
      issuedAt: d.issuedAt,
      location: d.location,
      fine: d.fine ? Number(d.fine) : undefined,
      amountDue: d.amountDue ? Number(d.amountDue) : undefined,
      status: d.status,
      decision: d.decision,
      source: 'PORTAL_LOOKUP',
    }),
  );
  const note = page.locator('[data-lookup-message]');
  const message = (await note.count()) ? z.enum(['plate_lookup_ma_only', 'not_found']).parse(await note.getAttribute('data-lookup-message')) : undefined;
  return { tickets, message };
}
