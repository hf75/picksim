"""PickSim asset pipeline: contact sheets (6 x 4 tiles) from the preview renders.

  python -I contact_sheet.py --previews DIR --out DIR [--manifest assets/models/manifest.json] [--quad]

--quad: each tile shows the four views (+Z, +X, -Z, -X) rendered with render_previews.py --views 4.
"""
import argparse, json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--previews", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--manifest", default=os.path.join(HERE, "..", "..", "assets", "models", "manifest.json"))
ap.add_argument("--list", default=os.path.join(HERE, "assets.json"))
ap.add_argument("--quad", action="store_true")
ap.add_argument("--prefix", default="sheet")
a = ap.parse_args()

cfg = json.load(open(a.list, encoding="utf-8"))
man = json.load(open(a.manifest, encoding="utf-8")) if os.path.exists(a.manifest) else {}
os.makedirs(a.out, exist_ok=True)
T, CAP, COLS, ROWS = (512 if a.quad else 256), 34, 6, 4
try:
    font = ImageFont.truetype("arial.ttf", 14)
    small = ImageFont.truetype("arial.ttf", 12)
except OSError:
    font = small = ImageFont.load_default()

tiles = []
for asset in cfg["assets"]:
    aid = asset["id"]
    if a.quad:
        views = [os.path.join(a.previews, f"{aid}__{v}.png") for v in ("pZ", "pX", "mZ", "mX")]
        if not all(os.path.exists(v) for v in views):
            continue
        im = Image.new("RGB", (T, T))
        for i, v in enumerate(views):
            im.paste(Image.open(v).convert("RGB").resize((T // 2, T // 2)), ((i % 2) * T // 2, (i // 2) * T // 2))
        d = ImageDraw.Draw(im)
        for i, lab in enumerate(("+Z", "+X", "-Z", "-X")):
            d.text(((i % 2) * T // 2 + 4, (i // 2) * T // 2 + 2), lab, fill=(255, 255, 0), font=small)
    else:
        p = os.path.join(a.previews, f"{aid}.png")
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGB").resize((T, T))
    m = man.get(aid, {})
    cap1 = aid
    cap2 = f"{m.get('tris', '?')} tris  {round(m.get('bytes', 0) / 1024)} KB  front {m.get('front', asset.get('front', '?'))}"
    tiles.append((im, cap1, cap2))

per = COLS * ROWS
for s in range(0, len(tiles), per):
    sheet = Image.new("RGB", (COLS * T, ROWS * (T + CAP)), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for i, (im, c1, c2) in enumerate(tiles[s:s + per]):
        x, y = (i % COLS) * T, (i // COLS) * (T + CAP)
        sheet.paste(im, (x, y))
        d.text((x + 4, y + T + 1), c1, fill=(255, 255, 255), font=font)
        d.text((x + 4, y + T + 18), c2, fill=(190, 190, 190), font=small)
    out = os.path.join(a.out, f"{a.prefix}_{s // per + 1:02d}.jpg")
    sheet.save(out, quality=90)
    print(out)
