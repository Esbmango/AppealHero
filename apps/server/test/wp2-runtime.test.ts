/**
 * WP2 agent runtime, context & tools — acceptance tests from docs/TASKS.md (WP2).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { describe, it } from 'vitest';

describe('WP2 agent runtime, context & tools', () => {
  it.todo('wp2: each stage exposes exactly its toolset');
  it.todo('wp2: model content is appended verbatim so thought signatures survive');
  it.todo('wp2: invalid tool arguments go back to the model and change nothing');
  it.todo('wp2: propose_outcome rejects grounds the playbook does not support');
  it.todo('wp2: the step cap hands the turn back to the user');
  it.todo('wp2: profile facts are in the context and never asked again');
  it.todo('wp2: lookup_tickets lists tickets for MA plates and asks for a ticket number otherwise');
});
