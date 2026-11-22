import { chromium, type Browser } from 'playwright';
import { config } from '../../core/config';

/** Fixed viewport + deviceScaleFactor 1 → screenshot pixels == CSS pixels (keeps Computer Use coordinates simple). */
export const VIEWPORT = { width: 1280, height: 800 };

let browser: Promise<Browser> | null = null;

export function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = chromium.launch({ headless: config.headless, channel: config.browserChannel, slowMo: config.slowMoMs || undefined }).catch((err: Error) => {
      browser = null;
      throw new Error(`Could not launch Chromium (${err.message}). Run "npm run browsers" or set BROWSER_CHANNEL=chrome.`);
    });
  }
  return browser;
}

export async function closeBrowser() {
  if (!browser) return;
  const b = await browser.catch(() => null);
  browser = null;
  await b?.close();
}
