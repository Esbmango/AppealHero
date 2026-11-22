/**
 * WP1 accounts & demo personas — acceptance tests from docs/TASKS.md (WP1).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import { describe, it } from 'vitest';

describe('WP1 accounts & demo personas', () => {
  it.todo('wp1: GET /api/me creates a user and sets a session cookie');
  it.todo('wp1: PUT /api/me validates and persists the profile');
  it.todo('wp1: plates are uppercased, delete works, exactly one default vehicle');
  it.todo('wp1: persona switch sets language, profile and vehicles');
  it.todo('wp1: a new case imports profile fields as PROFILE + CONFIRMED facts');
});
