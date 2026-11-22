/**
 * WP8 audit chain & proof page — acceptance tests from docs/TASKS.md (WP8).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { describe, it } from 'vitest';

describe('WP8 audit chain & proof page', () => {
  it.todo('wp8: the audit chain verifies and detects any tampering');
  it.todo('wp8: proof returns the approval hash, read-back hash, steps, receipt and chain head');
  it.todo('wp8: verify-audit.mjs exits 0 on a good export and 1 on a tampered one');
  it.todo('wp8: status-check is read-only and never submits');
});
