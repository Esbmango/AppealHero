/**
 * Assistant chat: reads screenshots the user took of the official results page; never browses itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OFFICIAL_TICKET_LOOKUP_URL, AssistantResponseSchema } from '@appealhero/shared';
import { config } from '../src/core/config';
import { analyzeTickets, categorize } from '../src/assistant';
import { demoPng, pixel } from './fixtures/demoPng';

const SAMPLE = path.resolve(__dirname, '../../web/public/sample-lookup-results.png');
type App = Awaited<ReturnType<(typeof import('../src/index'))['buildServer']>>['app'];
let app: App;
const saved = { aiMode: config.aiMode, persist: config.persist };

beforeAll(async () => {
  Object.assign(config, { aiMode: 'fake', persist: false });
  process.env.LOG_LEVEL = 'warn';
  const { buildServer } = await import('../src/index');
  ({ app } = await buildServer());
});
afterAll(async () => {
  await app.close();
  Object.assign(config, saved);
});

function form(fields: Record<string, string>, images: Buffer[] = []) {
  const boundary = '----appealhero' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  images.forEach((img, i) => {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="shot${i}.png"\r\nContent-Type: image/png\r\n\r\n`),
      img,
      Buffer.from('\r\n'),
    );
  });
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const ask = async (fields: Record<string, string>, images: Buffer[] = []) => {
  const res = await app.inject({ method: 'POST', url: '/api/assistant', ...form(fields, images) });
  return { status: res.statusCode, body: res.json() };
};

describe('assistant', () => {
  it('categorises printed statuses without guessing', () => {
    expect(categorize('Appeal Accepted', 0)).toBe('APPEAL_ACCEPTED');
    expect(categorize('Paid', 40)).toBe('PAID');
    expect(categorize('Appeal Denied', 40)).toBe('APPEAL_DENIED');
    expect(categorize('Hearing Scheduled', 40)).toBe('APPEAL_PENDING');
    expect(categorize('Open', 40)).toBe('OPEN');
    expect(categorize('Something new', 40)).toBe('OTHER');
  });

  it('computes the 21-day deadline and overdue flag in code', () => {
    const rows = [
      { ticketNumber: '1', amountDue: 40, violation: 'X', issueDate: '2026-10-01', plate: 'P', status: 'Open' },
      { ticketNumber: '2', amountDue: 0, violation: 'Y', issueDate: '2026-11-10', plate: 'P', status: 'Appeal Accepted' },
      { ticketNumber: '3', amountDue: 60, violation: 'Z', issueDate: '2026-11-15', plate: 'P', status: 'Open' },
    ];
    const a = analyzeTickets(rows, '2026-11-22');
    expect(a.latest?.ticketNumber).toBe('3');
    expect(a.tickets.find((t) => t.ticketNumber === '3')).toMatchObject({ deadline: '2026-12-06', daysLeft: 14, overdue: false });
    expect(a.tickets.find((t) => t.ticketNumber === '1')).toMatchObject({ deadline: '2026-10-22', overdue: true });
    expect(a.tickets.find((t) => t.ticketNumber === '2')?.deadline).toBeUndefined();
    expect(a).toMatchObject({ openCount: 2, totalDue: 100 });
  });

  it('asks the user to search the official site and upload a screenshot (it never browses)', async () => {
    for (const [lang, text] of [
      ['zh', '我最近一次罚单是什么时候？过期了吗？'],
      ['es', '¿Cuál es mi multa más reciente?'],
      ['en', 'When was my last ticket? Is it overdue?'],
    ]) {
      const { status, body } = await ask({ lang, text, history: '[]' });
      expect(status).toBe(200);
      const r = AssistantResponseSchema.parse(body);
      expect(r.reply).toContain(OFFICIAL_TICKET_LOOKUP_URL);
      expect(r.analysis).toBeUndefined();
    }
  });

  it('reads a synthetic results screenshot and reports the latest and open tickets', async () => {
    const { status, body } = await ask({ lang: 'zh', text: '', history: '[]' }, [fs.readFileSync(SAMPLE)]);
    expect(status).toBe(200);
    const r = AssistantResponseSchema.parse(body);
    expect(r.analysis?.tickets.map((t) => t.ticketNumber)).toEqual(['900000001', '980000011', '980000012', '980000013']);
    expect(r.analysis?.latest).toMatchObject({ ticketNumber: '900000001', category: 'OPEN' });
    expect(r.analysis?.tickets[1].category).toBe('APPEAL_ACCEPTED');
    expect(r.reply).toContain('900000001');
  });

  it('says so when the image is not a ticket list, and validates input', async () => {
    const other = await ask({ lang: 'en', text: '', history: '[]' }, [pixel]);
    expect(AssistantResponseSchema.parse(other.body)).toMatchObject({ notTicketList: true });
    expect((await ask({ lang: 'en', text: '', history: '[]' })).status).toBe(400);
    expect((await ask({ lang: 'en', text: 'hi', history: 'nope' })).status).toBe(400);
    const four = [1, 2, 3, 4].map(() => demoPng({ kind: 'sign', text: 'x', visibility: 'clear' }));
    expect((await ask({ lang: 'en', text: 'hi', history: '[]' }, four)).status).toBe(400);
  });
});
