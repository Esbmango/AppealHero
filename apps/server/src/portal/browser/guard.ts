import type { BrowserContext } from 'playwright';

/**
 * One-shot interlock for the final submit request. Armed only by the runner AFTER the read-back
 * hash matches the signed approval; the first matching POST consumes it.
 */
export class Interlock {
  private armed = false;
  armOnce() {
    this.armed = true;
  }
  disarm() {
    this.armed = false;
  }
  /** true = this request may pass (and the interlock is now spent) */
  take(): boolean {
    if (!this.armed) return false;
    this.armed = false;
    return true;
  }
}

/** Real government hosts are hard-blocked in this build, whatever the config says. */
export const HARD_BLOCK = [/(^|\.)boston\.gov$/i, /(^|\.)cityofboston\.gov$/i, /(^|\.)rmcpay\.com$/i];

/**
 * Network-layer guard — the last line of defense, below the LLM, the CU policy and the UI:
 *  1. hard-block real portals, 2. allowlist one origin, 3. abort any submit POST the gate did not arm.
 * Whatever clicks or keys a model produces, an un-approved submission cannot leave the browser.
 */
export async function installNetworkGuard(
  context: BrowserContext,
  o: { allowedOrigin: string; submitPath: RegExp; interlock: Interlock; onBlocked: (url: string, why: string) => void },
) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    let url: URL;
    try {
      url = new URL(req.url());
    } catch {
      return route.abort('blockedbyclient');
    }
    if (HARD_BLOCK.some((rx) => rx.test(url.hostname))) {
      o.onBlocked(req.url(), 'real government portal is hard-blocked in this build');
      return route.abort('blockedbyclient');
    }
    if (url.origin !== o.allowedOrigin) {
      o.onBlocked(req.url(), 'origin is not on the allowlist');
      return route.abort('blockedbyclient');
    }
    if (req.method() === 'POST' && o.submitPath.test(url.pathname) && !o.interlock.take()) {
      o.onBlocked(req.url(), 'final submission attempted without passing the approval gate');
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}
