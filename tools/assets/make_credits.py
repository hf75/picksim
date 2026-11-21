"""Write assets/CREDITS.md (German) from assets.json, the WH dependency list of fetch_assets.py and the
texture/HDRI/font sources of fetch_textures.py.

  python -I make_credits.py [--cache DIR] [--out PROJECT/assets/CREDITS.md]
"""
import argparse, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
CC_BY = "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)"
CC0 = "CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)"
OFL = "SIL Open Font License 1.1 (https://openfontlicense.org)"

# extra changes beyond "nach glTF konvertiert, vereinfacht, Texturen verkleinert"
EXTRA = {
    "scanner_handheld": "Kabel und Ladeschale entfernt",
    "scanner_stand": "Kabel entfernt",
}

# role -> (title, authors, url, remark); see fetch_textures.py
TEXTURES = [
    ("floor_concrete_clean", "Concrete Floor Worn 001", "Dimitrios Savva, Rico Cilliers (Poly Haven)", "https://polyhaven.com/a/concrete_floor_worn_001", "Albedo aufgehellt"),
    ("floor_concrete_worn", "Garage Floor", "Jenelle van Heerden (Poly Haven)", "https://polyhaven.com/a/garage_floor", ""),
    ("floor_old", "Old Wood Floor", "Guillaume Monsergent (Poly Haven)", "https://polyhaven.com/a/old_wood_floor", ""),
    ("wall_brick_old", "Red Brick 03", "Rob Tuytel (Poly Haven)", "https://polyhaven.com/a/red_brick_03", ""),
    ("wall_panel_metal", "Corrugated Iron", "Jenelle van Heerden, Dimitrios Savva (Poly Haven)", "https://polyhaven.com/a/corrugated_iron", ""),
    ("wall_plaster", "Painted Plaster Wall", "Amal Kumar (Poly Haven)", "https://polyhaven.com/a/painted_plaster_wall", ""),
    ("wood_planks", "Plywood", "Rob Tuytel (Poly Haven)", "https://polyhaven.com/a/plywood", ""),
    ("metal_painted", "Metal 014", "ambientCG (Lennart Demes)", "https://ambientcg.com/view?id=Metal014", "Metallic-Kanal auf 0 gesetzt (lackierte Oberfläche)"),
    ("metal_galvanized", "Metal 039", "ambientCG (Lennart Demes)", "https://ambientcg.com/view?id=Metal039", ""),
    ("fabric_canvas", "Hessian 380", "colormass, Rico Cilliers (Poly Haven)", "https://polyhaven.com/a/hessian_380", "Metallic-Kanal auf 0 gesetzt"),
    ("rubber_mat", "Rubber Tiles", "Amal Kumar (Poly Haven)", "https://polyhaven.com/a/rubber_tiles", ""),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.environ.get("PICKSIM_ASSET_CACHE") or os.path.join(os.environ.get("TEMP", "."), "picksim-asset-cache"))
    ap.add_argument("--out", default=os.path.normpath(os.path.join(HERE, "..", "..", "assets", "CREDITS.md")))
    a = ap.parse_args()
    cfg = json.load(open(os.path.join(HERE, "assets.json"), encoding="utf-8"))
    deps_path = os.path.join(a.cache, "wh_dependencies.json")
    deps = json.load(open(deps_path, encoding="utf-8")) if os.path.exists(deps_path) else {}
    stats_path = os.path.join(a.cache, "_raw_glb", "_optimize_stats.json")
    stats = json.load(open(stats_path, encoding="utf-8")) if os.path.exists(stats_path) else {}

    L = []
    L.append("# Quellen und Lizenzen (PickSim-Assets)\n")
    L.append("Alle 3D-Modelle in `assets/models/` stammen aus den NVIDIA-SimReady-Datensätzen auf Hugging Face und "
             f"stehen unter der Lizenz {CC_BY}. Die Lizenz verlangt die Namensnennung des Urhebers, einen Link zur "
             "Lizenz und die Angabe von Änderungen; dazu dient diese Datei (bitte im Impressum/Info-Bereich der "
             "Anwendung verlinken). Texturen und HDRI sind gemeinfrei (CC0), die Schriften stehen unter der SIL Open "
             "Font License.\n")
    L.append("## 3D-Modelle (NVIDIA Corporation, CC BY 4.0)\n")
    L.append("Datensätze: „SimReady Assets“ (https://huggingface.co/datasets/nvidia/simready-assets) und "
             "„PhysicalAI-SimReady-Warehouse-01“ (https://huggingface.co/datasets/nvidia/PhysicalAI-SimReady-Warehouse-01).\n")
    for asset in cfg["assets"]:
        repo = cfg["repos"][asset["src"]]
        title = asset["path"].rstrip("/").split("/")[-1]
        url = f"https://huggingface.co/datasets/{repo}/tree/main/{asset['path']}"
        changes = ["nach glTF konvertiert", "vereinfacht", "Texturen verkleinert"]
        st = stats.get(asset["id"], {})
        if st.get("udim"):
            changes.append("UDIM-Texturen zu einem Atlas zusammengefasst")
        if asset["id"] in EXTRA:
            changes.append(EXTRA[asset["id"]])
        line = (f"- **{asset['id']}.glb** – „{title}“ von NVIDIA Corporation, Quelle {url}, Lizenz {CC_BY}, "
                f"Änderungen: {', '.join(changes)}")
        if asset["src"] == "WH" and asset["id"] in deps:
            parts = sorted({"/".join(p.split("/")[:3]) for p in deps[asset["id"]] if p.startswith("Props/")}
                           - {asset["path"]})
            if parts:
                names = ", ".join(p.split("/")[-1] for p in parts)
                line += f". Enthält Teil-Assets desselben Datensatzes: {names}"
        L.append(line + ".")
    L.append("")
    L.append("## PBR-Texturen (CC0)\n")
    for role, title, authors, url, remark in TEXTURES:
        rem = "verkleinert, ins WebP-Format umgewandelt, ARM-Map (AO/Rauheit/Metall) gepackt" + (f", {remark}" if remark else "")
        L.append(f"- **textures/{role}/** – „{title}“ von {authors}, Quelle {url}, Lizenz {CC0}; Änderungen: {rem}.")
    L.append("")
    L.append("## HDRI (CC0)\n")
    L.append(f"- **hdri/warehouse_1k.hdr, warehouse_2k.hdr** – „Empty Warehouse 01“ von Sergej Majboroda (Poly Haven), "
             f"Quelle https://polyhaven.com/a/empty_warehouse_01, Lizenz {CC0}; unverändert (1k- und 2k-Auflösung).")
    L.append("")
    L.append("## Schriften (SIL Open Font License 1.1)\n")
    L.append(f"- **fonts/InterVariable.woff2, InterVariable-Italic.woff2** – „Inter“ von Rasmus Andersson und Mitwirkenden, "
             f"Quelle https://github.com/rsms/inter (Version 4.1), Lizenz {OFL}, Lizenztext: `fonts/Inter-OFL.txt`.")
    L.append(f"- **fonts/JetBrainsMono-Regular/SemiBold/Bold.woff2** – „JetBrains Mono“ von JetBrains s.r.o., "
             f"Quelle https://github.com/JetBrains/JetBrainsMono (Version 2.304), Lizenz {OFL}, Lizenztext: `fonts/JetBrainsMono-OFL.txt`.")
    L.append("")
    L.append("## Werkzeuge\n")
    L.append("Konvertierung mit Blender 5.2 (GPL), glTF-Transform (MIT), meshoptimizer (MIT) und sharp/libvips (Apache 2.0/LGPL); "
             "die Werkzeuge sind nicht Teil der ausgelieferten Dateien. Ablauf: `tools/assets/README_DE.md`.")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("written", a.out)


if __name__ == "__main__":
    main()
