/**
 * WP2 agent runtime, context & tools — acceptance tests from docs/TASKS.md (WP2).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { newCaseRecord, CaseStore } from '../src/core/store/cases';
import { EventHub } from '../src/core/hub';
import { JsonAuditRepo } from '../src/core/store/audit';
import { JsonUserRepo } from '../src/core/store/users';
import { buildPortal } from '../../mock-portal/src/index';
import { config } from '../src/core/config';
import { runTool, toolsFor } from '../src/agent/tools';
import { transition } from '../src/core/fsm';
import { describe, expect, it } from 'vitest';

describe('WP2 agent runtime, context & tools', () => {
  it.todo('wp2: each stage exposes exactly its toolset');
  it.todo('wp2: model content is appended verbatim so thought signatures survive');
  it.todo('wp2: invalid tool arguments go back to the model and change nothing');
  it.todo('wp2: the step cap hands the turn back to the user');
  it.todo('wp2: profile facts are in the context and never asked again');
  it('wp2: lookup_tickets lists tickets for MA plates and asks for a ticket number otherwise', async () => {
    const ctx = { store: new CaseStore(null), hub: new EventHub(), audit: new JsonAuditRepo(null), users: new JsonUserRepo(null) };
    const c = newCaseRecord('en');
    ctx.store.put(c);
    transition(ctx, c.id, 'IDENTIFYING', 'system', 'lookup');
    const portal = await buildPortal();
    const original = config.mockPortalUrl;
    try {
      config.mockPortalUrl = await portal.listen({ host: '127.0.0.1', port: 0 });
      const ny = await runTool(ctx, c.id, 'lookup_tickets', { plate: 'KDT4821', state: 'NY' });
      expect(ny.result).toMatchObject({ tickets: [], message: 'plate_lookup_ma_only' });
      const ma = await runTool(ctx, c.id, 'lookup_tickets', { plate: '8KDW21', state: 'MA' });
      expect(ma.isError).toBeFalsy();
      expect(c.lookupResults?.some((t) => t.ticketNumber === '900000001' && t.status === 'OPEN')).toBe(true);
    } finally {
      config.mockPortalUrl = original;
      await portal.close();
    }
    expect(toolsFor('IDENTIFYING').map((t) => t.name)).toEqual(expect.arrayContaining(['lookup_tickets', 'select_ticket']));
    expect((await runTool(ctx, c.id, 'select_ticket', { ticketNumber: '900000001' })).isError).toBe(true);
    expect(c.ticket).toBeUndefined();
    expect(c.state).toBe('IDENTIFYING');
  });
});
