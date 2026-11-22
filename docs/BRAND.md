# AppealHero brand — Boston Civic Modern

An independent civic-tech brand for Boston. Local, calm and trustworthy; not a government site and not an "AI" look.

## Logo

Core: **brick arch + ticket (with notches) + check + Harbor Navy / Boston Brick**. The check means *reviewed and confirmed*, never "appeal guaranteed".

| File (`apps/web/public/`) | Use |
|---|---|
| `brand/logo-primary.svg` | Horizontal lockup: header, slides, README. Min height 24 px. |
| `brand/logo-stacked.svg` | Large spaces only (hero, poster, title slide). Only version with the Beacon Hill lantern. |
| `brand/logo-symbol.svg` | Symbol with brick joints and document lines, ≥ 32 px. |
| `favicon.svg`, `favicon-32.png` | Simplified symbol for 16–32 px: no joints, no document lines, heavier check. |
| `brand/app-icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Navy tile for home screens; `icon-maskable-512.png` keeps the art inside the maskable safe zone. |
| `brand/logo-white.svg`, `brand/logo-symbol-white.svg` | One colour, details knocked out (transparent) — for navy or photo backgrounds. |
| `brand/logo-mono.svg` | One colour navy, for single-colour print. |

All files are generated, real vectors: `python3 scripts/brand/build_logos.py`, then `node scripts/brand/render_pngs.mjs` for the PNGs. The wordmark is outlined from **Source Serif 4 SemiBold** (SIL Open Font License 1.1), so no font is needed to display it.

Changes from the concept art: the State House dome under the wordmark was removed (it read as an official mark and disappears at small sizes); the lantern appears only in the stacked lockup; the arch has 6 bricks + a brass keystone instead of ~15 bricks; one step instead of two; two document lines instead of three; a larger check.

Clear space: the height of the keystone on every side. Don't recolour, rotate, outline or add effects; don't put the colour logo on brick or busy photos (use the white version).

## Colour

| Name | Hex | Use | Contrast on Ivory |
|---|---|---|---|
| Harbor Navy | `#1D3443` | Text, primary buttons, brand | 12.2 : 1 |
| Boston Brick | `#A54B3E` | Brand accent, eyebrow labels, "Hero" | 5.4 : 1 (AA for text) |
| Warm Ivory | `#FAF8F3` | Page background | — |
| Antique Brass | `#B28B57` | Keystone, rules — **decoration only** | 2.9 : 1 (not for text) |
| Mist | `#DCE2DE` | Dividers, hairlines | — |

Status colours stay distinct from the brand: success `#2F6B4F`, warning `#946620` / `#7E5719` text, error `#A3362B` (deeper than Brick so errors never read as decoration). Neutrals run from Ivory to Navy (`--color-slate-*` in `apps/web/src/index.css`).

## Type

- **Inter** (400/500/600, OFL) for all UI, forms, chat and data.
- **Source Serif 4 SemiBold** (OFL) only for English/Spanish headlines (`.serif-title`) and the wordmark.
- Chinese uses the system sans (PingFang SC, Microsoft YaHei, Noto Sans SC); no serif CJK.
- Fonts are bundled through `@fontsource`; nothing loads from a CDN.

## UI

Ivory page, white cards with a 1 px mist border and 10 px radius, 8 px controls, navy primary buttons, outline secondary buttons, brick only for brand emphasis. Line icons (`components/icons.tsx`) instead of emoji. Every tappable control gives a short press response (scale 0.965) that is disabled for reduced-motion users. Keep the one-line independence notice: AppealHero is not affiliated with the City of Boston, and the demo files on a simulated portal.
