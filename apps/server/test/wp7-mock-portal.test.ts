/**
 * WP7 simulated portal v2 — acceptance tests from docs/TASKS.md (WP7).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_TICKETS } from '@appealhero/shared';

type Portal = Awaited<ReturnType<(typeof import('../../mock-portal/src/index'))['buildPortal']>>;
let portal: Portal;

beforeAll(async () => {
  const { buildPortal } = await import('../../mock-portal/src/index');
  portal = await buildPortal({ hangMs: 10 });
});
afterAll(async () => {
  await portal.close();
});

const get = async (url: string) => {
  const res = await portal.inject({ url });
  return { status: res.statusCode, body: res.body };
};
/** Attribute values of every [data-ticket-row] on a page, in order. */
const rows = (html: string) =>
  [...html.matchAll(/<article class="tk" data-ticket-row([^>]*)>/g)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  );
const message = (html: string) => /data-lookup-message="([a-z_]+)"/.exec(html)?.[1];

describe('WP7 simulated portal v2', () => {
  it('wp7: every page shows the SIMULATED banner and noindex', async () => {
    const pages = [
      '/',
      '/lookup?plate=8KDW21&state=MA',
      '/lookup?plate=KDT4821&state=NY',
      '/lookup?ticketNumber=999999999',
      '/ticket/900000001',
      '/ticket/980000012/hearing',
      '/faq',
      '/contact',
      '/appeal/start',
      '/status?ticket=900000001',
      '/inbox',
    ];
    for (const url of pages) {
      const { body } = await get(url);
      expect(body, url).toContain('SIMULATED PORTAL FOR TESTING ONLY');
      expect(body, url).toContain('NOT AFFILIATED WITH THE CITY OF BOSTON');
      expect(body, url).toContain('<meta name="robots" content="noindex,nofollow">');
      // no official marks: the header carries the joke emblem, never a seal or an official's name
      expect(body, url).not.toMatch(/Mayor|BOSTONIA|CONDITA/);
    }
  });

  it('wp7: /lookup follows the markup contract', async () => {
    // MA plate → every ticket for that vehicle, newest first, with machine-readable attributes
    const ma = await get('/lookup?plate=8kdw21&state=MA');
    expect(ma.status).toBe(200);
    expect(ma.body).toContain('data-lookup-results');
    const list = rows(ma.body);
    expect(list.map((r) => r['ticket-number'])).toEqual(['900000001', '980000011', '980000012', '980000013']);
    expect(list[0]).toMatchObject({
      plate: '8KDW21',
      state: 'MA',
      violation: 'METER FEE UNPAID',
      'issued-at': DEMO_TICKETS.meter.issuedAt,
      location: DEMO_TICKETS.meter.location,
      fine: '40.00',
      'amount-due': '40.00',
      status: 'OPEN',
    });
    expect(list[1]).toMatchObject({ status: 'APPEALED', decision: 'ACCEPTED', 'amount-due': '0.00' });
    expect(list[2]).toMatchObject({ status: 'PAID' });
    for (const r of list) expect(['OPEN', 'PAID', 'APPEALED']).toContain(r.status);

    // other states: plate search is Massachusetts-only, ticket number works
    expect(message((await get('/lookup?plate=KDT4821&state=NY')).body)).toBe('plate_lookup_ma_only');
    expect(rows((await get('/lookup?ticketNumber=900000006')).body).map((r) => r['ticket-number'])).toEqual(['900000006']);
    // VIN finds the out-of-state vehicle's tickets too
    expect(rows((await get('/lookup?vin=1ZZDEMA0000004821')).body).map((r) => r['ticket-number'])).toEqual(['900000002', '900000006', '980000031']);
    expect(message((await get('/lookup?ticketNumber=999999999')).body)).toBe('not_found');
    expect((await get('/lookup')).body).toContain('Please enter a ticket number');

    // read-only: lookup is GET-only and never creates sessions or appeals
    expect((await portal.inject({ method: 'POST', url: '/lookup', payload: {} })).statusCode).toBe(404);
    const state = (await portal.inject({ url: '/admin/state' })).json() as { sessions: number; appeals: unknown[] };
    expect(state.sessions).toBe(0);
    expect(state.appeals).toHaveLength(0);
  });

  it('wp7: seeds include all 5 synthetic tickets and one plate with two tickets', async () => {
    for (const t of Object.values(DEMO_TICKETS)) {
      const r = rows((await get(`/lookup?ticketNumber=${t.ticketNumber}`)).body);
      expect(r, t.ticketNumber).toHaveLength(1);
      expect(r[0]).toMatchObject({ plate: t.plateNumber, state: t.plateState, status: 'OPEN' });
    }
    const open = rows((await get('/lookup?vin=1ZZDEMA0000004821')).body).filter((r) => r.status === 'OPEN');
    expect(open.map((r) => r['ticket-number']).sort()).toEqual(['900000002', '900000006']);
    // closed history tickets cannot be appealed online
    const closed = await portal.inject({
      method: 'POST',
      url: '/appeal/start',
      payload: { ticketNumber: '980000012', plateNumber: '8KDW21', plateState: 'MA' },
    });
    expect(closed.statusCode).toBe(422);
    expect(closed.body).toContain('cannot be appealed online');
  });

  it.todo('wp7: the new scenarios behave as specified');
  it.todo('wp7: /admin/state reports submissions for the test oracle');
});
