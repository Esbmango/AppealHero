/**
 * WP8 audit chain & proof page — acceptance tests from docs/TASKS.md (WP8).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { JsonAuditRepo, verifyChain } from '../src/core/store/audit';
import { describe, expect, it } from 'vitest';

describe('WP8 audit chain & proof page', () => {
  it('wp8: the audit chain verifies and detects any tampering', () => {
    const audit = new JsonAuditRepo(null);
    for (const type of ['approval', 'exec.step', 'receipt']) audit.append({ caseId: 'test', type, data: { value: type } });
    const events = structuredClone(audit.list('test'));
    expect(verifyChain(events)).toEqual({ ok: true });
    events[1].data = { value: 'changed' };
    expect(verifyChain(events)).toEqual({ ok: false, brokenAt: 2 });
  });
  it.todo('wp8: verify-audit.mjs exits 0 on a good export and 1 on a tampered one');
});
