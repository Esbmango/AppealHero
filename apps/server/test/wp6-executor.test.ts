/**
 * WP6 executor & portal adapters — acceptance tests from docs/TASKS.md (WP6).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { describe, it } from 'vitest';

describe('WP6 executor & portal adapters', () => {
  it.todo('wp6: every v0.2 portal scenario still passes on the v2 flow');
  it.todo('wp6: lookup handles MA plates, out-of-state plates, not found and multiple tickets');
  it.todo('wp6: every job records a Playwright trace');
  it.todo('wp6: session_expired re-runs safely and still files exactly one appeal');
  it.todo('wp6: upload_rejected ends in NEEDS_USER with a clear reason');
  it.todo('wp6: injected page text never changes executor actions');
  it.todo('wp6: fake CU hits every /calibrate target within 1% of the viewport');
});
