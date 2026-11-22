import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { config } from '../../core/config';
import type { Ctx } from '../../core/ctx';

const counters = new Map<string, number>();

/** Save a JPEG to data/shots/<case>/ and emit its URL (never base64 over SSE). */
export async function snap(ctx: Ctx, caseId: string, page: Page, label: string) {
  try {
    const n = (counters.get(caseId) ?? 0) + 1;
    counters.set(caseId, n);
    const dir = path.join(config.dataDir, 'shots', caseId);
    fs.mkdirSync(dir, { recursive: true });
    const file = `${String(n).padStart(3, '0')}-${label.replace(/[^\w-]+/g, '-').slice(0, 40)}.jpg`;
    await page.screenshot({
      path: path.join(dir, file),
      type: 'jpeg',
      quality: 60,
      mask: config.maskPii ? [page.locator('[data-pii]')] : [],
    });
    ctx.hub.emit({ type: 'exec.screenshot', caseId, url: `/api/shots/${caseId}/${file}`, label });
  } catch {
    /* screenshots are best-effort */
  }
}
