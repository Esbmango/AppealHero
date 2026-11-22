"""
Builds the AppealHero logo set as real vector SVGs (no embedded bitmaps).
Wordmark glyphs are outlined from Source Serif 4 SemiBold (SIL OFL 1.1, @fontsource/source-serif-4).
Run: python3 scripts/brand/build_logos.py   (then node scripts/brand/render_pngs.mjs for PNG icons)
"""
import math, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'apps/web/public/brand')
FONT = os.path.join(ROOT, 'node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2')

NAVY, BRICK, IVORY, BRASS = '#1D3443', '#A54B3E', '#FAF8F3', '#B28B57'
GLASS = '#F1E2C2'

def f(x):
    return f'{x:.2f}'.rstrip('0').rstrip('.')

# ---------- symbol geometry (64 x 64 grid) ----------
CX, CY, R_OUT, R_IN = 32, 27, 21, 14
BASE_Y = 55

def polar(r, deg):
    a = math.radians(deg)
    return CX + r * math.cos(a), CY - r * math.sin(a)

def arch_path():
    return (f'M{CX-R_OUT},{BASE_Y} L{CX-R_OUT},{CY} A{R_OUT},{R_OUT} 0 0 1 {CX+R_OUT},{CY} L{CX+R_OUT},{BASE_Y} '
            f'L{CX+R_IN},{BASE_Y} L{CX+R_IN},{CY} A{R_IN},{R_IN} 0 0 0 {CX-R_IN},{CY} L{CX-R_IN},{BASE_Y} Z')

def door_path():
    return f'M{CX-R_IN},{BASE_Y} L{CX-R_IN},{CY} A{R_IN},{R_IN} 0 0 1 {CX+R_IN},{CY} L{CX+R_IN},{BASE_Y} Z'

def keystone(r0=13.2, r1=23.2, a0=97, a1=83):
    p = [polar(r0, a0), polar(r1, a0 + 1.5), polar(r1, a1 - 1.5), polar(r0, a1)]
    return 'M' + ' L'.join(f'{f(x)},{f(y)}' for x, y in p) + ' Z'

def joints(color):
    lines = []
    for deg in (152, 124, 56, 28):
        (x0, y0), (x1, y1) = polar(R_IN, deg), polar(R_OUT, deg)
        lines.append(f'<line x1="{f(x0)}" y1="{f(y0)}" x2="{f(x1)}" y2="{f(y1)}"/>')
    for y in (35, 43):
        lines.append(f'<line x1="{CX-R_OUT}" y1="{y}" x2="{CX-R_IN}" y2="{y}"/><line x1="{CX+R_IN}" y1="{y}" x2="{CX+R_OUT}" y2="{y}"/>')
    return f'<g stroke="{color}" stroke-width="1.3" stroke-linecap="butt">{"".join(lines)}</g>'

TICKET = 'M24.6,21 H30 A2.6,2.6 0 0 0 34,21 H39.4 A1.6,1.6 0 0 1 41,22.6 V49.4 A1.6,1.6 0 0 1 39.4,51 H34 A2.6,2.6 0 0 0 30,51 H24.6 A1.6,1.6 0 0 1 23,49.4 V22.6 A1.6,1.6 0 0 1 24.6,21 Z'
LINES = '<path d="M27,29 H37 M27,34 H34" fill="none" stroke-width="2" stroke-linecap="round"/>'
CHECK = 'M27.4,41.6 L30.9,45 L37,38.2'
BASE = f'<rect x="7" y="{BASE_Y}" width="50" height="3.6" rx="1"/>'

def symbol(detail=True, palette=None, x=0, y=0, s=1.0):
    """detail=False: favicon / small sizes (no joints, no document lines)."""
    p = palette or {'arch': BRICK, 'door': NAVY, 'ticket': IVORY, 'ink': NAVY, 'check': BRICK, 'key': BRASS, 'joint': IVORY, 'base': NAVY}
    parts = [f'<path d="{arch_path()}" fill="{p["arch"]}"/>']
    if p.get('door'):
        parts.append(f'<path d="{door_path()}" fill="{p["door"]}"/>')
    if detail and p.get('joint'):
        parts.append(joints(p['joint']))
    parts.append(f'<path d="{keystone()}" fill="{p["key"]}"/>')
    parts.append(f'<path d="{TICKET}" fill="{p["ticket"]}"/>')
    if detail:
        parts.append(f'<g stroke="{p["ink"]}">{LINES}</g>')
    parts.append(f'<path d="{CHECK}" fill="none" stroke="{p["check"]}" stroke-width="{2.8 if detail else 3.6}" stroke-linecap="round" stroke-linejoin="round"/>')
    parts.append(f'<g fill="{p["base"]}">{BASE}</g>')
    return f'<g transform="translate({f(x)} {f(y)}) scale({f(s)})">{"".join(parts)}</g>'

def lantern(x=0, y=0, s=1.0):
    # Simplified Beacon Hill wall lantern on a bracket from the right pillar (stacked lockup only).
    g = f'''<g fill="none" stroke="{NAVY}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
<path d="M53,33 H60"/><path d="M53,40 C57,40 60,37.5 60,33"/></g>
<path d="M61,17.4 m-1.1,0 a1.1,1.1 0 1 0 2.2,0 a1.1,1.1 0 1 0 -2.2,0" fill="{NAVY}"/>
<path d="M56.8,22.4 L61,18.6 L65.2,22.4 Z" fill="{NAVY}"/>
<path d="M57.6,22.4 H64.4 L63.5,30.6 H58.5 Z" fill="{BRASS}"/>
<path d="M59.3,24 H62.7 L62.2,29.2 H59.8 Z" fill="{GLASS}"/>
<path d="M58.5,30.6 H63.5 L61,33.2 Z" fill="{NAVY}"/>'''
    return f'<g transform="translate({f(x)} {f(y)}) scale({f(s)})">{g}</g>'

# ---------- wordmark ----------
font = TTFont(FONT)
cmap, gs, hmtx = font.getBestCmap(), font.getGlyphSet(), font['hmtx']
UPM = font['head'].unitsPerEm
CAP = font['OS/2'].sCapHeight or 0.66 * UPM

def word_paths(text, size, x0, baseline, tracking=-0.012):
    """Returns (svg path d, advance width). Glyph outlines, kerning from advances only (plus tracking)."""
    scale, x, ds = size / UPM, x0, []
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        ds.append(pen.getCommands())
        x += hmtx[g][0] * scale + tracking * size
    return ' '.join(ds), x - x0

def wordmark(x0, baseline, size, appeal=NAVY, hero=BRICK):
    a, wa = word_paths('Appeal', size, x0, baseline)
    h, wh = word_paths('Hero', size, x0 + wa, baseline)
    return f'<path d="{a}" fill="{appeal}"/><path d="{h}" fill="{hero}"/>', wa + wh

def svg(w, h, body, title='AppealHero'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" width="{f(w)}" height="{f(h)}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')

def write(name, content, folder=OUT):
    with open(os.path.join(folder, name), 'w') as fh:
        fh.write(content)

# Symbol (64 grid). The symbol spans x 7..57, y 4..58.6 → crop a little.
write('logo-symbol.svg', svg(64, 64, symbol(True)))
write(os.path.join('..', 'favicon.svg'), svg(64, 64, symbol(False)))

# App icon: navy tile, symbol knocked into ivory / brick (door = tile).
ICON_P = {'arch': BRICK, 'door': None, 'ticket': IVORY, 'ink': NAVY, 'check': BRICK, 'key': BRASS, 'joint': NAVY, 'base': IVORY}
write('app-icon.svg', svg(512, 512, f'<rect width="512" height="512" rx="112" fill="{NAVY}"/>' + symbol(True, ICON_P, x=256 - 32 * 6.6, y=256 - 31 * 6.6, s=6.6)))
write('app-icon-maskable.svg', svg(512, 512, f'<rect width="512" height="512" fill="{NAVY}"/>' + symbol(True, ICON_P, x=256 - 32 * 5.2, y=256 - 31 * 5.2, s=5.2)))

# Horizontal primary: symbol (height 48) + wordmark; cap height ≈ 0.5 of symbol.
S = 0.88  # symbol scale → about 48 px tall
size = 34
cap = CAP * size / UPM
sym_h = 54.6 * S
baseline = (4 * S) + sym_h / 2 + cap / 2 + 1
wm, wwidth = wordmark(0, 0, size)
x_text = 60 * S + 10
body = symbol(True, x=-6 * S, s=S) + f'<g transform="translate({f(x_text)} {f(baseline)})">{wm}</g>'
W, H = x_text + wwidth + 2, 62 * S
write('logo-primary.svg', svg(W, H, body))

# Single-colour versions: solid shapes with the door, document lines and check knocked out (transparent).
def knockout_symbol(color, mask_id):
    holes = {"arch": "#fff", "door": "#000", "ticket": "#fff", "ink": "#000", "check": "#000", "key": "#fff", "joint": "#000", "base": "#fff"}
    mask = (f'<mask id="{mask_id}" maskUnits="userSpaceOnUse"><rect x="-10" y="-10" width="200" height="200" fill="#fff"/>'
            f'{symbol(True, holes)}</mask>')
    solid = f'<path d="{arch_path()}"/><path d="{keystone()}"/><path d="{TICKET}"/>{BASE}'
    return f'<defs>{mask}</defs><g mask="url(#{mask_id})" fill="{color}">{solid}</g>'

for name, color, mask_id in (('logo-white.svg', '#FFFFFF', 'ah-ko-white'), ('logo-mono.svg', NAVY, 'ah-ko-navy')):
    wm_c, _ = wordmark(0, 0, size, color, color)
    write(name, svg(W, H, f'<g transform="translate({f(-6 * S)} 0) scale({f(S)})">{knockout_symbol(color, mask_id)}</g>'
                          f'<g transform="translate({f(x_text)} {f(baseline)})">{wm_c}</g>'))
write('logo-symbol-white.svg', svg(64, 64, knockout_symbol('#FFFFFF', 'ah-ko-sym')))

# Stacked: larger symbol with the lantern, wordmark centred below, thin brass rule.
SS = 2.2
size2 = 52
wm2, w2 = wordmark(0, 0, size2)
cap2 = CAP * size2 / UPM
sym_w = 70 * SS  # arch + lantern
Wst = max(w2, sym_w) + 40
sym_x = (Wst - 50 * SS) / 2 - 7 * SS  # centre the arch (x 7..57), lantern hangs to the right
top = 6
stack = symbol(True, x=sym_x, y=top, s=SS) + lantern(x=sym_x, y=top, s=SS)
base_y = top + 60 * SS + 22 + cap2
stack += f'<g transform="translate({f((Wst - w2) / 2)} {f(base_y)})">{wm2}</g>'
rule_y = base_y + 22
stack += f'<rect x="{f(Wst / 2 - 90)}" y="{f(rule_y)}" width="180" height="1.6" fill="{BRASS}"/>'
write('logo-stacked.svg', svg(Wst, rule_y + 10, stack))
print('wrote', sorted(os.listdir(OUT)), 'favicon.svg')
