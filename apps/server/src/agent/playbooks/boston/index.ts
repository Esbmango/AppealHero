import type { Playbook } from '@appealhero/shared';

import { meter } from './meter';
import { permit } from './resident_permit';
import { hydrant } from './hydrant';
export const BOSTON_PLAYBOOKS: readonly Playbook[] = [meter, permit, hydrant];
