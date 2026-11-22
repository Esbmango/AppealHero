/**
 * WP5 writer & policy — acceptance tests from docs/TASKS.md (WP5).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { describe, it } from 'vitest';

describe('WP5 writer & policy', () => {
  it.todo('wp5: drafts cite only existing, groundable facts');
  it.todo('wp5: drafts fit the 2000-character portal limit');
  it.todo('wp5: "make it shorter" shortens the draft and keeps user-written paragraphs');
  it.todo('wp5: a new fact inside a revision request is recorded as USER_STATEMENT');
  it.todo('wp5: any statement change changes the approval hash and the old approval gets 409');
  it.todo('wp5: claims contradicted by evidence are flagged and left out of the draft');
  it.todo("wp5: every draft has a translation in the user's language");
});
