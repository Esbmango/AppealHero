import { chromium, type Browser } from 'playwright';
import { config } from '../../core/config';

/** Fixed viewport + deviceScaleFactor 1 → screenshot pixels == CSS pixels (keeps Computer Use coordinates simple). */
export const VIEWPORT = { width: 1280, height: 800 };

let browser: Promise<Browser> | null = null;

function launch(): Promise<Browser> {
  const pending = chromium
    .launch({ headless: config.headless, channel: config.browserChannel, slowMo: config.slowMoMs || undefined })
    .then((b) => {
      // A crashed or manually closed browser (e.g. someone closes the visible window during a demo) must not
      // break every later filing until the server restarts: forget it and launch a fresh one next time.
      b.on('disconnected', () => {
        if (browser === pending) browser = null;
      });
      return b;
    })
    .catch((err: Error) => {
      if (browser === pending) browser = null;
      throw new Error(`Could not launch Chromium (${err.message}). Run "npm run browsers" or set BROWSER_CHANNEL=chrome.`);
    });
  browser = pending;
  return pending;
}

export async function getBrowser(): Promise<Browser> {
  const current = await (browser ?? launch());
  return current.isConnected() ? current : launch();
}

export async function closeBrowser() {
  if (!browser) return;
  const b = await browser.catch(() => null);
  browser = null;
  await b?.close();
}
