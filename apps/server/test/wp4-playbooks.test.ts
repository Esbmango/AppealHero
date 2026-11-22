/**
 * WP4 playbooks, rules & fake driver — acceptance tests from docs/TASKS.md (WP4).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { describe, it } from 'vitest';

describe('WP4 playbooks, rules & fake driver', () => {
  it.todo('wp4: violations map to the right playbook and unknown ones to generic');
  it.todo('wp4: every rule has a source, checkedAt and verified flag');
  it.todo('wp4: unverified rules never produce grounds');
  it.todo('wp4: ideal paths ask at most 3 questions');
  it.todo('wp4: every golden test listed in PLAYBOOKS.md passes');
});
