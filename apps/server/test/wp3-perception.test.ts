/**
 * WP3 perception & synthetic fixtures — acceptance tests from docs/TASKS.md (WP3).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { describe, it } from 'vitest';

describe('WP3 perception & synthetic fixtures', () => {
  it.todo('wp3: fake perception reads ground truth from the PNG text chunk');
  it.todo('wp3: two ticket photos merge into one ticket and low confidence asks for a retake');
  it.todo('wp3: a receipt yields paid_until as NEEDS_CONFIRMATION');
  it.todo('wp3: a sign photo yields posted hours, months and visibility');
  it.todo('wp3: audio yields the original text plus English');
  it.todo('wp3: make_ticket.py generates every fixture the golden tests use');
});
