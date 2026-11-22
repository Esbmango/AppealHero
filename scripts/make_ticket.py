"""Usage: python3 scripts/make_ticket.py meter|permit|hydrant out.png
Synthetic demo ticket image. Deliberately NOT a replica of a real Boston citation (no seal, no city branding)."""
import sys
from PIL import Image, ImageDraw, ImageFont

TICKETS = {
    "meter": [("TICKET NO.", "900000001"), ("DATE / TIME", "11/15/2026  2:32 PM"), ("PLATE", "8KDW21"), ("STATE", "MA"), ("VIOLATION", "METER FEE UNPAID"), ("LOCATION", "700 COMMONWEALTH AVE"), ("FINE", "$40.00")],
    "permit": [("TICKET NO.", "900000002"), ("DATE / TIME", "11/18/2026  10:05 AM"), ("PLATE", "KDT4821"), ("STATE", "NY"), ("VIOLATION", "RESIDENT PERMIT ONLY"), ("LOCATION", "BAY STATE RD"), ("FINE", "$60.00")],
    "hydrant": [("TICKET NO.", "900000003"), ("DATE / TIME", "11/19/2026  7:40 PM"), ("PLATE", "5NB302"), ("STATE", "MA"), ("VIOLATION", "HYDRANT"), ("LOCATION", "BEACON ST"), ("FINE", "$100.00")],
}
key, out = sys.argv[1], sys.argv[2]
W, H = 900, 1000
img = Image.new("RGB", (W, H), (252, 250, 240))
d = ImageDraw.Draw(img)
F = "/usr/share/fonts/truetype/dejavu/"
big = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 46)
mid = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 30)
reg = ImageFont.truetype(F + "DejaVuSans.ttf", 30)
mono = ImageFont.truetype(F + "DejaVuSansMono-Bold.ttf", 40)
small = ImageFont.truetype(F + "DejaVuSans.ttf", 22)

d.rectangle([0, 0, W, 120], fill=(30, 41, 59))
d.text((40, 32), "PARKING VIOLATION NOTICE", font=big, fill="white")
d.text((40, 138), "SAMPLE FOR SOFTWARE DEMO - NOT A REAL CITATION", font=ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 25), fill=(185, 28, 28))

rows = TICKETS[key]
y = 210
for label, value in rows:
    d.text((40, y), label, font=reg, fill=(71, 85, 105))
    d.text((360, y - 4), value, font=mono, fill=(15, 23, 42))
    y += 90
    d.line([40, y - 22, W - 40, y - 22], fill=(203, 213, 225), width=2)

d.text((40, y + 10), "Pay or appeal within 21 days. (Synthetic data for AppealHero tests.)", font=small, fill=(71, 85, 105))
# diagonal watermark
wm = Image.new("RGBA", (W, H), (0, 0, 0, 0))
wd = ImageDraw.Draw(wm)
wd.text((60, 520), "SAMPLE  SAMPLE  SAMPLE", font=ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 90), fill=(185, 28, 28, 55))
wm = wm.rotate(28, center=(W / 2, H / 2))
img = Image.alpha_composite(img.convert("RGBA"), wm).convert("RGB")
img.save(out, optimize=True)
print("wrote", out)
