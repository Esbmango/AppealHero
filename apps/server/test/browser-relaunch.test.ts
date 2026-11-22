/** The executor's shared browser is relaunched after it crashes or is closed. */
import { afterAll, describe, expect, it } from 'vitest';
import { closeBrowser, getBrowser } from '../src/portal/browser/browser';
import { config } from '../src/core/config';

describe('shared executor browser', () => {
  afterAll(() => closeBrowser());
  it('launches a new browser when the previous one was closed', async () => {
    Object.assign(config, { headless: true });
    const first = await getBrowser();
    expect(await getBrowser()).toBe(first);
    await first.close(); // what a crash or a closed window looks like to us
    const second = await getBrowser();
    expect(second).not.toBe(first);
    expect(second.isConnected()).toBe(true);
    const context = await second.newContext();
    await context.close();
  });
});
