"""Render a synthetic ticket or receipt with the same data used to seed the demo portal.
Usage (from repo root): python scripts/make_ticket.py meter_weekday|meter|permit|hydrant|receipt out.png

Tickets copy the *layout* of a paper parking ticket from a handheld thermal printer (orange label bars, monospace
values, fee schedule) so the photo flow is tested against something realistic. They are clearly marked SAMPLE,
carry no city name, seal or wordmark, and every value is synthetic (packages/shared/src/demo.ts).
The exact values are embedded as a PNG tEXt chunk ("appealhero:truth") for the offline (AI_MODE=fake) driver.
"""
import argparse
import json
import random
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, PngImagePlugin

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("sample", choices=["meter", "permit", "hydrant", "meter_weekday", "receipt"])
parser.add_argument("output", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
source = "import {DEMO_TICKETS,DEMO_RECEIPTS,DEMO_PERSONAS} from './packages/shared/src/demo.ts'; console.log(JSON.stringify([DEMO_TICKETS,DEMO_RECEIPTS,DEMO_PERSONAS]))"
tickets, receipts, personas = json.loads(subprocess.check_output(["node", "--import", "tsx", "--input-type=module", "-e", source], cwd=root))
is_receipt = args.sample == "receipt"
key = "meterWeekday" if args.sample in ("receipt", "meter_weekday") else args.sample
ticket = tickets[key]
rng = random.Random(ticket["ticketNumber"])  # same picture every time

PAPER, INK, ORANGE, FADED = "#f6f3ec", "#1d1d1f", "#f39a3d", "#55514a"


def font(size, kind="label"):
    names = {
        "label": ("LiberationSansNarrow-Bold.ttf", "Arial Narrow Bold.ttf", "DejaVuSansCondensed-Bold.ttf", "Arial Bold.ttf"),
        "mono": ("LiberationMono-Bold.ttf", "Courier New Bold.ttf", "DejaVuSansMono-Bold.ttf", "Menlo.ttc"),
        "head": ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "LiberationSans-Bold.ttf"),
        "small": ("DejaVuSans.ttf", "Arial.ttf", "LiberationSans-Regular.ttf"),
    }[kind]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def vehicle_for(plate):
    for persona in personas.values():
        for vehicle in persona["vehicles"]:
            if vehicle["plate"] == plate:
                return vehicle["make"].upper(), vehicle["color"].upper()
    return "TOYOTA", "GRAY"


def barcode(draw, x, y, width, height):
    cursor = x
    while cursor < x + width:
        bar = rng.choice((2, 3, 3, 5, 7))
        draw.rectangle((cursor, y, cursor + bar - 1, y + height), fill=INK)
        cursor += bar + rng.choice((2, 3, 4, 6))


def bar(draw, x0, x1, y, labels):
    """An orange field bar with printed labels; values are printed just above it."""
    draw.rectangle((x0, y, x1, y + 34), fill=ORANGE)
    draw.line((x0, y + 36, x1, y + 36), fill=INK, width=3)
    for lx, text in labels:
        draw.text((lx, y + 3), text, font=font(25), fill=INK)


def watermark(image, text):
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    big = font(int(image.width * 0.17), "head")
    box = ImageDraw.Draw(layer).textbbox((0, 0), text, font=big)
    at = ((image.width - (box[2] - box[0])) // 2, (image.height - (box[3] - box[1])) // 2)
    ImageDraw.Draw(layer).text(at, text, font=big, fill=(196, 48, 43, 38))
    layer = layer.rotate(28, resample=Image.BICUBIC, center=(image.width // 2, image.height // 2))
    image.paste(layer, (0, 0), layer)


def finish(image):
    # a little softness so it reads as a print, not a screenshot (no grain: it would triple the file size)
    return image.filter(ImageFilter.GaussianBlur(0.45))


if is_receipt:
    receipt = receipts["meterWeekday"]
    truth = dict(kind="receipt", plate=ticket["plateNumber"], paidFrom=receipt["paidFrom"], paidUntil=receipt["paidUntil"])
    paid_from, paid_until = (datetime.fromisoformat(truth[k]) for k in ("paidFrom", "paidUntil"))
    image = Image.new("RGB", (760, 1040), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 760, 120), fill="#1d3443")
    draw.text((40, 26), "SAMPLE PARKING APP RECEIPT", font=font(34, "head"), fill="white")
    draw.text((40, 74), "Simulated - AppealHero demo", font=font(24, "small"), fill="#dce2de")
    lines = [
        ("PLATE", truth["plate"]),
        ("ZONE", "890 COMMONWEALTH AVE"),
        ("DATE", paid_from.strftime("%m/%d/%Y")),
        ("START", paid_from.strftime("%I:%M %p")),
        ("END", paid_until.strftime("%I:%M %p")),
        ("AMOUNT", "$%.2f" % receipt["amount"]),
        ("STATUS", "PAID"),
    ]
    for index, (label, value) in enumerate(lines):
        y = 170 + index * 92
        draw.text((40, y), label, font=font(26), fill=FADED)
        draw.text((260, y - 4), value, font=font(36, "mono"), fill=INK)
        draw.line((40, y + 62, 720, y + 62), fill="#d9d4ca", width=2)
    draw.text((40, 840), "SESSION #S-%s" % ticket["ticketNumber"][-5:], font=font(28, "mono"), fill=INK)
    draw.text((40, 960), "Synthetic data for AppealHero tests. Not a real receipt.", font=font(22, "small"), fill="#a54b3e")
    watermark(image, "SAMPLE")
else:
    truth = dict(kind="ticket", **ticket)
    issued = datetime.fromisoformat(ticket["issuedAt"])
    pay_by = issued + timedelta(days=21)
    make, color = vehicle_for(ticket["plateNumber"])
    image = Image.new("RGB", (900, 1360), PAPER)
    draw = ImageDraw.Draw(image)
    left, right = 70, 830

    # header band: no city name, seal or wordmark (AGENTS.md)
    draw.rectangle((left - 10, 30, right + 10, 200), fill=ORANGE)
    draw.text((left + 14, 44), "SAMPLE - NOT A REAL TICKET", font=font(28), fill=INK)
    draw.text((left + 14, 82), "PARKING VIOLATION", font=font(58, "head"), fill=INK)
    draw.text((left + 14, 158), "SIMULATED  /  APPEALHERO DEMO", font=font(26), fill=INK)
    barcode(draw, 470, 172, 350, 62)

    draw.text((left + 150, 250), ticket["ticketNumber"], font=font(64, "mono"), fill=INK)
    draw.text((left, 325), "VIOLATION #", font=font(30), fill=INK)

    mid = 470
    rows = [
        (440, [(left + 10, "DATE"), (mid + 10, "TIME")], [(left + 30, issued.strftime("%m/%d/%y")), (mid + 120, issued.strftime("%I:%M %p").lstrip("0"))]),
        (540, [(left + 10, "REGISTRATION"), (mid + 10, "TO")], [(left + 30, ticket["plateNumber"])]),
        (640, [(left + 10, "STATE"), (280, "PLATE TYPE"), (600, "COLOR")], [(left + 30, ticket["plateState"]), (280, "PASSENGER"), (600, color)]),
        (740, [(left + 10, "VEHICLE MAKE"), (360, "TYPE"), (600, "ROUTE")], [(left + 30, make), (360, "4DR")]),
        (840, [(left + 10, "LOCATION")], [(left + 30, ticket["location"].upper().replace(", BOSTON", ""))]),
        (940, [(left + 10, "VIOLATION DESCRIPTION"), (650, "METER NO.")], [(left + 30, ticket["violationDescription"])]),
    ]
    for y, labels, values in rows:
        for vx, value in values:
            draw.text((vx, y - 52), value, font=font(38, "mono"), fill=INK)
        bar(draw, left, right, y, labels)
        for x in {lx for lx, _ in labels[1:]}:
            draw.line((x - 12, y - 60, x - 12, y + 34), fill=INK, width=2)

    draw.text((430, 1000), "$%.2f" % ticket["fineAmount"], font=font(52, "mono"), fill=INK)
    draw.rectangle((left, 1070, 420, 1112), fill=ORANGE)
    draw.text((left + 30, 1076), "AMOUNT DUE:", font=font(32), fill=INK)

    draw.line((left, 1150, right, 1150), fill=INK, width=2)
    draw.text((left, 1166), "COMMENTS:", font=font(28), fill=FADED)
    draw.text((left, 1210), "PAY BY:  %s   $%.2f" % (pay_by.strftime("%m/%d/%y"), ticket["fineAmount"]), font=font(34, "mono"), fill=INK)
    draw.text((left, 1290), "Synthetic data for AppealHero tests. Not issued by any government.", font=font(21, "small"), fill="#a54b3e")
    # the side number, as printed vertically along the edge
    side = Image.new("RGBA", (420, 50), (0, 0, 0, 0))
    ImageDraw.Draw(side).text((0, 0), ticket["ticketNumber"] + "   " + ticket["plateNumber"], font=font(36, "mono"), fill=INK)
    side = side.rotate(90, expand=True)
    image.paste(side, (842, 560), side)
    watermark(image, "SAMPLE")

image = finish(image)
metadata = PngImagePlugin.PngInfo()
metadata.add_text("appealhero:truth", json.dumps(truth, separators=(",", ":")))
image.save(args.output, pnginfo=metadata, optimize=True)
