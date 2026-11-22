/**
 * WP3 perception & synthetic fixtures — acceptance tests from docs/TASKS.md (WP3).
 * Each it.todo name must stay identical to the card. Implement by replacing it.todo with it(...).
 * Never delete or rename these: wp0-foundation.test.ts checks that every acceptance name exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEMO_TICKETS } from '@appealhero/shared';
import { demoPng } from './fixtures/demoPng';
import { readDemoTruth } from '../src/agent/perception/demoTruth';
import { describe, expect, it } from 'vitest';

describe('WP3 perception & synthetic fixtures', () => {
  it('wp3: fake perception reads ground truth from the PNG text chunk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appealhero-truth-'));
    try {
      const ticket = { kind: 'ticket', ...DEMO_TICKETS.meterWeekday };
      const file = path.join(dir, 'ticket.png');
      fs.writeFileSync(file, demoPng(ticket));
      expect(readDemoTruth(file)).toEqual(ticket);
      fs.writeFileSync(file, demoPng(ticket).subarray(0, 40));
      expect(readDemoTruth(file)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it.todo('wp3: two ticket photos merge into one ticket and low confidence asks for a retake');
  it.todo('wp3: a receipt yields paid_until as NEEDS_CONFIRMATION');
  it.todo('wp3: a sign photo yields posted hours, months and visibility');
  it.todo('wp3: audio yields the original text plus English');
  it.todo('wp3: make_ticket.py generates every fixture the golden tests use');
});
