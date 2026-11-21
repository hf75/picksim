"""PickSim: CC0 PBR textures (Poly Haven / ambientCG), HDRI (Poly Haven) and OFL fonts.

  python -I fetch_textures.py [--cache DIR] [--out PROJECT/assets] [--only role1,role2]

Writes <out>/textures/<role>/{albedo,normal,arm}.webp (arm: R=AO, G=roughness, B=metal; normal = OpenGL/+Y),
<out>/hdri/warehouse_{1k,2k}.hdr and <out>/fonts/*.woff2 + licence files. Needs Pillow (with WebP support).
"""
import argparse, io, json, os, sys, urllib.request, zipfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "picksim-asset-fetch/1.0"}

# role -> (source, asset id, size in px[, adjustments])
#   albedo_mean: brighten/darken the albedo (in linear light) to this mean sRGB value
#   metal: overwrite the metalness channel (B of arm) with a constant
TEXTURES = {
    "floor_concrete_clean": ("polyhaven", "concrete_floor_worn_001", 2048, {"albedo_mean": 0.56}),
    "floor_concrete_worn":  ("polyhaven", "garage_floor", 2048),
    "floor_old":            ("polyhaven", "old_wood_floor", 2048),
    "wall_brick_old":       ("polyhaven", "red_brick_03", 1024),
    "wall_panel_metal":     ("polyhaven", "corrugated_iron", 1024),
    "wall_plaster":         ("polyhaven", "painted_plaster_wall", 1024),
    "wood_planks":          ("polyhaven", "plywood", 1024),
    "metal_painted":        ("ambientcg", "Metal014", 1024, {"metal": 0}),
    "metal_galvanized":     ("ambientcg", "Metal039", 1024),
    "fabric_canvas":        ("polyhaven", "hessian_380", 1024, {"metal": 0}),
    "rubber_mat":           ("polyhaven", "rubber_tiles", 1024),
}
HDRI = ("polyhaven", "empty_warehouse_01")
FONTS = [
    ("https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable.woff2", "InterVariable.woff2"),
    ("https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable-Italic.woff2", "InterVariable-Italic.woff2"),
    ("https://raw.githubusercontent.com/rsms/inter/v4.1/LICENSE.txt", "Inter-OFL.txt"),
    ("https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/webfonts/JetBrainsMono-Regular.woff2", "JetBrainsMono-Regular.woff2"),
    ("https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/webfonts/JetBrainsMono-SemiBold.woff2", "JetBrainsMono-SemiBold.woff2"),
    ("https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/webfonts/JetBrainsMono-Bold.woff2", "JetBrainsMono-Bold.woff2"),
    ("https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/OFL.txt", "JetBrainsMono-OFL.txt"),
]


def get(url, dest=None):
    if dest and os.path.exists(dest) and os.path.getsize(dest) > 0:
        return open(dest, "rb").read()
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
        data = r.read()
    if dest:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest + ".part", "wb") as f:
            f.write(data)
        os.replace(dest + ".part", dest)
    return data


def ph_maps(asset, res, cache):
    files = json.loads(get(f"https://api.polyhaven.com/files/{asset}", os.path.join(cache, f"ph_{asset}.json")))
    k = "2k" if res > 1024 else "1k"
    out = {}
    for key, fmt in (("Diffuse", "png"), ("nor_gl", "png"), ("arm", "png")):
        entry = files[key][k]
        f = entry.get(fmt) or entry.get("jpg")
        url = f["url"]
        out[key] = Image.open(io.BytesIO(get(url, os.path.join(cache, asset, os.path.basename(url)))))
    return out["Diffuse"], out["nor_gl"], out["arm"]


def acg_maps(asset, res, cache):
    k = "2K-PNG" if res > 1024 else "1K-PNG"
    url = f"https://ambientcg.com/get?file={asset}_{k}.zip"
    z = zipfile.ZipFile(io.BytesIO(get(url, os.path.join(cache, f"{asset}_{k}.zip"))))
    names = z.namelist()

    def pick(tag):
        for n in names:
            if tag.lower() in n.lower() and n.lower().endswith((".png", ".jpg")):
                return Image.open(io.BytesIO(z.read(n)))
        return None
    color, nrm = pick("_Color"), pick("_NormalGL")
    rough, metal, ao = pick("_Roughness"), pick("_Metalness"), pick("_AmbientOcclusion")
    size = color.size
    L = lambda im, fill: (im.convert("L").resize(size) if im is not None else Image.new("L", size, fill))
    arm = Image.merge("RGB", (L(ao, 255), L(rough, 128), L(metal, 0)))
    return color, nrm, arm


def write_webp(im, path, size, q, mode="RGB"):
    im = im.convert(mode)
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    im.save(path, "WEBP", quality=q, method=6)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(os.environ.get("PICKSIM_ASSET_CACHE") or os.path.join(os.environ.get("TEMP", "."), "picksim-asset-cache"), "_textures_src"))
    ap.add_argument("--out", default=os.path.normpath(os.path.join(HERE, "..", "..", "assets")))
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = set(x for x in a.only.split(",") if x)
    report = {}
    for role, entry in TEXTURES.items():
        src, asset, size = entry[:3]
        adj = entry[3] if len(entry) > 3 else {}
        if only and role not in only:
            continue
        alb, nrm, arm = (ph_maps if src == "polyhaven" else acg_maps)(asset, size, a.cache)
        if "albedo_mean" in adj:
            import numpy as np
            x = np.asarray(alb.convert("RGB"), dtype=np.float32) / 255.0
            lin = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
            t_lin = ((adj["albedo_mean"] + 0.055) / 1.055) ** 2.4
            lin = np.clip(lin * (t_lin / max(1e-4, float(lin.mean()))), 0, 1)
            x = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
            alb = Image.fromarray((x * 255 + 0.5).astype("uint8"), "RGB")
        if "metal" in adj:
            r, g, b = arm.convert("RGB").split()
            arm = Image.merge("RGB", (r, g, Image.new("L", r.size, int(adj["metal"] * 255))))
        d = os.path.join(a.out, "textures", role)
        os.makedirs(d, exist_ok=True)
        write_webp(alb, os.path.join(d, "albedo.webp"), size, 85)
        write_webp(nrm, os.path.join(d, "normal.webp"), size, 90)
        write_webp(arm, os.path.join(d, "arm.webp"), size, 85)
        kb = sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d)) / 1024
        report[role] = (src, asset, size, round(kb))
        print(f"{role:22s} {src:9s} {asset:26s} {size}px {kb:7.0f} KB", flush=True)
    if not only or "hdri" in only:
        files = json.loads(get(f"https://api.polyhaven.com/files/{HDRI[1]}", os.path.join(a.cache, f"ph_{HDRI[1]}.json")))
        d = os.path.join(a.out, "hdri")
        os.makedirs(d, exist_ok=True)
        for k in ("1k", "2k"):
            url = files["hdri"][k]["hdr"]["url"]
            data = get(url, os.path.join(a.cache, os.path.basename(url)))
            open(os.path.join(d, f"warehouse_{k}.hdr"), "wb").write(data)
            print(f"hdri {k}: {len(data) / 1e6:.1f} MB")
    if not only or "fonts" in only:
        d = os.path.join(a.out, "fonts")
        os.makedirs(d, exist_ok=True)
        for url, name in FONTS:
            data = get(url, os.path.join(a.cache, "fonts", name))
            open(os.path.join(d, name), "wb").write(data)
            print(f"font {name}: {len(data) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
