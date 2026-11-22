/** Static WP9 checks; browser acceptance scenarios live in wp9-flow.test.ts. */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { PhoneFlow } from '../src/components/PhoneFlow';

const sourceRoot = path.resolve(import.meta.dirname, '../src');
function filesIn(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(folder, entry.name);
    return entry.isDirectory() ? filesIn(filename) : [filename];
  });
}
function hardcodedCopy(source: string): string[] {
  // Deliberately small source scanner: Chinese copy anywhere in TSX, visible JSX text,
  // accessibility copy, and obvious string-valued JSX expressions. No compiler API dependency.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = code.match(/[^\n]*\p{Script=Han}[^\n]*/gu) ?? [];
  for (const match of code.matchAll(/>\s*([^<>{}\n]+)\s*<\//g)) {
    if (/\p{L}/u.test(match[1])) found.push(match[1].trim());
  }
  for (const match of code.matchAll(/(?:title|placeholder|aria-label|alt)\s*=\s*["']([^"']+)["']/g)) {
    if (/\p{L}/u.test(match[1])) found.push(match[1]);
  }
  for (const match of code.matchAll(/\{\s*["']([^"']+)["']\s*\}/g)) {
    if (/\p{L}/u.test(match[1])) found.push(match[1]);
  }
  for (const match of code.matchAll(/(?:>|\n\s*)\{[^{}\n]*\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']\s*\}/g)) {
    for (const value of match.slice(1)) if (/\p{L}/u.test(value)) found.push(value);
  }
  return found;
}

describe('WP9 phone web app v2', () => {
  it('wp9: no hardcoded UI strings outside locale files', () => {
    const violations = filesIn(sourceRoot)
      .filter((file) => file.endsWith('.tsx') && !file.includes('/i18n/'))
      .flatMap((file) => hardcodedCopy(fs.readFileSync(file, 'utf8')).map((text) => `${path.relative(sourceRoot, file)}: ${text}`));
    expect(violations).toEqual([]);
    expect(hardcodedCopy('<button>Send</button><input placeholder="Your name" /><p>{ready ? "已确认" : "Pending"}</p>')).toContain('Send');
    expect(hardcodedCopy('<button>{t("chat.send")}</button>')).toEqual([]);
  });
  it('wp9: phone-flow tap targets are at least 44px', async () => {
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const html = renderToStaticMarkup(createElement(PhoneFlow, { c: null, events: [], onCreated: () => {}, onNew: () => {}, refresh: () => {} }));
      // Test the real phone control stylesheet against the rendered onboarding controls.
      // The smoke script also checks every subsequent stage using the built Tailwind CSS.
      await page.setContent(`<style>${fs.readFileSync(path.join(sourceRoot, 'index.css'), 'utf8').replace(/@import[^;]+;/g, '')}</style>${html}`);
      const sizes = await page.locator('.phone-flow button, .phone-flow select, .phone-flow input').evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
      expect(sizes.length).toBeGreaterThan(5);
      expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
