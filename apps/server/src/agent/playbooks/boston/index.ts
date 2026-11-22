import type { Playbook } from '@appealhero/shared';

/**
 * Boston playbooks (owner: WP4) — docs/PLAYBOOKS.md §4. One file per ticket type:
 * meter.ts, resident_permit.ts, street_cleaning.ts, hydrant.ts, no_stopping.ts, generic.ts (+ common.ts).
 * Until WP4 lands, the fake driver keeps its v0.2 per-type logic (agent/fake).
 */
export const BOSTON_PLAYBOOKS: readonly Playbook[] = [];
