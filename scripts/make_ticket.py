"""Render a synthetic ticket or receipt with the same data used to seed the demo portal.
Usage (from repo root): python scripts/make_ticket.py meter_weekday|meter|permit|hydrant|receipt out.png
"""
import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, PngImagePlugin

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("sample", choices=["meter", "permit", "hydrant", "meter_weekday", "receipt"])
parser.add_argument("output", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
source = "import {DEMO_TICKETS,DEMO_RECEIPTS} from './packages/shared/src/demo.ts'; console.log(JSON.stringify([DEMO_TICKETS,DEMO_RECEIPTS]))"
tickets, receipts = json.loads(subprocess.check_output(["node", "--import", "tsx", "--input-type=module", "-e", source], cwd=root))
is_receipt = args.sample == "receipt"
ticket = tickets["meterWeekday" if args.sample in ("receipt", "meter_weekday") else args.sample]
ink, accent, muted = "#193833", "#14675c", "#4d625f"
image = Image.new("RGB", (940, 920), "#f7f6ef")
draw = ImageDraw.Draw(image)

def font(size, bold=False):
    for name in (("DejaVuSans-Bold.ttf", "arialbd.ttf") if bold else ("DejaVuSans.ttf", "arial.ttf")):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)

def moment(value):
    return datetime.fromisoformat(value).strftime("%b %d, %Y  %I:%M %p")

if is_receipt:
    receipt = receipts["meterWeekday"]
    truth = dict(kind="receipt", plate=ticket["plateNumber"], paidFrom=receipt["paidFrom"], paidUntil=receipt["paidUntil"])
    title = "SIMULATED RECEIPT"
    rows = [("Plate", truth["plate"]), ("Parking zone (demo)", "890 / Commonwealth Ave"),
            ("Paid from", moment(truth["paidFrom"])), ("Paid until", moment(truth["paidUntil"])),
            ("Amount paid", "$%.2f" % receipt["amount"])]
else:
    truth = dict(kind="ticket", **ticket)
    title = "SAMPLE PARKING TICKET"
    rows = [("Ticket number", ticket["ticketNumber"]), ("Issued at", moment(ticket["issuedAt"])),
            ("Vehicle", ticket["plateState"] + "   " + ticket["plateNumber"]), ("Violation", ticket["violationDescription"]),
            ("Location", ticket["location"]), ("Fine", "$%.2f" % ticket["fineAmount"])]
draw.rectangle((0, 0, 940, 150), fill=ink)
draw.text((46, 32), "AppealHero   /   Demo", font=font(24), fill="#a7ddd0")
draw.text((46, 77), title, font=font(43, True), fill="white")
for index, (label, value) in enumerate(rows):
    y = 188 + index * 100
    draw.text((48, y), label, font=font(22), fill=muted)
    draw.text((48, y + 33), value, font=font(32, True), fill=ink)
    draw.line((48, y + 83, 892, y + 83), fill="#c9d3ce", width=2)
draw.text((48, 843), "Synthetic data for AppealHero tests.", font=font(23), fill=accent)
metadata = PngImagePlugin.PngInfo()
metadata.add_text("appealhero:truth", json.dumps(truth, separators=(",", ":")))
image.save(args.output, pnginfo=metadata, optimize=True)
