import type { Playbook } from '@appealhero/shared';
import { BOSTON_PLAYBOOKS } from './boston';

/** Playbook registry (owner: WP4). The generic playbook must be last: it matches everything. */
export const PLAYBOOKS: readonly Playbook[] = [...BOSTON_PLAYBOOKS];

export const matchPlaybook = (violation: string): Playbook | undefined => PLAYBOOKS.find((p) => p.match(violation));
