# PickSim – Asset-Pipeline (NVIDIA SimReady → GLB für Browser und Meta Quest 3)

Diese Skripte erzeugen die Modelle in `assets/models/` (GLB + `manifest.json`) sowie Texturen, HDRI und
Schriften in `assets/textures/`, `assets/hdri/` und `assets/fonts/`. Rohdaten (OpenUSD, mehrere GB) und
`node_modules` liegen bewusst **außerhalb** des OneDrive-Projektordners.

| Schritt | Skript | Werkzeug | Ergebnis |
|---|---|---|---|
| 1 | `fetch_assets.py` | Python aus Blender (enthält `pxr`) | OpenUSD-Quellen im Cache |
| 2 | `convert_blender.py` | Blender 5.2 (Hintergrundmodus) | Roh-GLB je Asset (`<Cache>\_raw_glb`) |
| 3 | `optimize.mjs` | Node 20+ mit glTF-Transform 4.5, meshoptimizer, sharp | `assets/models/*.glb`, `manifest.json` |
| 4 | `render_previews.py`, `contact_sheet.py` | Blender, Python + Pillow | Kontrollbilder (Kontaktbögen) |
| 5 | `fetch_textures.py` | Python + Pillow + numpy | CC0-Texturen, HDRI, OFL-Schriften |
| 6 | `verify.mjs`, `make_credits.py` | Node, Python | Prüfbericht, `assets/CREDITS.md` |

Die Asset-Liste steht in `assets.json` (IDs, Quelle, Budgetklasse, Sonderregeln).

## Voraussetzungen

* Blender 5.2 LTS (Standardpfad `C:\Program Files\Blender Foundation\Blender 5.2`, sonst Umgebungsvariable `BLENDER_DIR`)
* Python 3.11+ mit Pillow (WebP-Unterstützung) und numpy (für Schritt 4/5)
* Node.js 20+; die npm-Pakete einmalig in einen Ordner außerhalb von OneDrive installieren:

```powershell
npm install --prefix "$env:TEMP\picksim-node-tools" @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@1.2.0 sharp@0.35.5 gltf-validator@2.0.0-dev.3.10
```

## Pfade und Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PICKSIM_ASSET_CACHE` | `%TEMP%\picksim-asset-cache` | Rohdaten-Cache (USD, Texturen, Roh-GLB) |
| `PICKSIM_NODE_MODULES` | `%TEMP%\picksim-node-tools\node_modules` | npm-Pakete für `optimize.mjs` |
| `PICKSIM_RAW_GLB` | `<Cache>\_raw_glb` | Ausgabe von Schritt 2 / Eingabe von Schritt 3 |
| `BLENDER_DIR` | `C:\Program Files\Blender Foundation\Blender 5.2` | für `pxr` in Schritt 1 |

**Wichtig:** Der Cache-Pfad muss kurz bleiben. Blender kann Dateien mit Pfaden über 260 Zeichen nicht lesen
(einige Warehouse-Texturen liegen sehr tief); dann fehlen Texturen ohne Fehlermeldung.

## Ablauf (PowerShell, im Ordner `tools\assets`)

```powershell
$blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$bpy     = "C:\Program Files\Blender Foundation\Blender 5.2\5.2\python\bin\python.exe"

# 1) Quellen laden (ca. 7,8 GB, bereits vorhandene Dateien werden übersprungen)
& $bpy -I fetch_assets.py                       # optional: --only forklift,pallet --cache D:\cache

# 2) USD -> Roh-GLB (ein Blender-Prozess für alle Assets, ca. 5 min)
& $blender -b --factory-startup --python convert_blender.py -- [--only forklift,pallet]

# 3) Optimieren -> assets\models\*.glb + manifest.json
node optimize.mjs                               # optional: --only ..., --modules <node_modules>

# 4) Kontrolle: Vorschaubilder + Kontaktbögen (6 x 4 Kacheln; Licht aus assets\hdri\warehouse_1k.hdr, grauer Hintergrund)
& $blender -b --factory-startup --python render_previews.py -- --out "$env:TEMP\picksim-previews"
python -I contact_sheet.py --previews "$env:TEMP\picksim-previews" --out "$env:TEMP\picksim-previews"
#    (--views 4 bzw. --quad: vier Ansichten je Asset, hilfreich zum Bestimmen von "front")

# 5) Texturen, HDRI, Schriften
python -I fetch_textures.py                     # optional: --only floor_old,hdri,fonts

# 6) Prüfen (glTF-Validator, Wurzelknoten, Ursprung, Budgets) und Quellenangaben schreiben
node verify.mjs
python -I make_credits.py
```

Nach Änderungen an `front`/`notes` in `assets.json` genügt `node optimize.mjs --manifest-only`, um
`manifest.json` neu zu schreiben (nutzt die Werte des letzten Laufs).

Mit `--only` lassen sich einzelne Assets neu bauen; `manifest.json` wird dabei ergänzt, nicht ersetzt.

## Was die Pipeline macht

* **Import:** nur die Render-Geometrie (keine Guides/Proxies/Kollisionsnetze, keine Kameras/Lichter/Physik).
  SimReady-Materialien (UsdPreviewSurface) übernimmt Blender direkt; reine MDL-Materialien der
  Warehouse-01-Assets (OmniPBR/OmniGlass) wandelt ein USD-Import-Hook in Principled-BSDF um
  (Farbtönung, Albedo-Anpassung, Texturkachelung, Transparenz, `project_uvw` als Box-Projektion).
* **UDIM:** glTF kennt keine UDIM-Kacheln; sie werden zu einem Atlas je Map zusammengefasst und die UVs umgerechnet.
* **Normierung:** Meter, Y-oben, Ursprung unten mittig (x/z zentriert, min. y = 0), genau ein Wurzelknoten `<id>`
  mit neutraler Transformation. Bewegliche Teile (`keep` in `assets.json`) bleiben eigene Knoten mit ihrem
  Original-Drehpunkt. Jedes Mesh hängt in einem Kindknoten `<name>_mesh`, der die Dequantisierung
  (Skalierung/Versatz aus `KHR_mesh_quantization`) trägt – `<id>` und die Teile-Knoten bleiben frei bewegbar.
* **Materialien in Kompositionen:** Warehouse-Kompositionen werden vor dem Import entinstanziert und geglättet
  (USD-Flatten), sonst greift der Material-Hook nicht; objektgebundene Materialien werden ans Mesh übertragen.
* **Vereinfachung:** meshoptimizer mit **einer** absoluten Fehlergrenze für das ganze Asset (binäre Suche bis zum
  Dreiecksbudget, Obergrenze 2,5 % der Diagonale bzw. `maxErr`), Normalen werden mitgewichtet, Nähte bleiben erhalten.
  Bei starker Vereinfachung (Fehler > 0,3 % der Diagonale) werden die Normalen aus der reduzierten Fläche neu
  berechnet (Auto-Smooth 45°), sonst entstehen streifige Schattierungen auf großen Flächen.
* **Materialien:** ORM-Textur wird zusätzlich als `occlusionTexture` gesetzt; nahezu einfarbige Texturen werden durch
  Faktoren ersetzt; doppelseitig nur bei offener Geometrie bzw. Alpha-Test; teure `KHR_materials_*`-Erweiterungen
  (Transmission, IOR, Specular …) werden entfernt (Glas = Alpha-Blending).
* **Transparenz:** SimReady-Materialien `trans__*` (Glas, Stretchfolie, Klarsichtbox) werden als Alpha-Blend
  exportiert (Glas α ≈ 0,25, sonst ≈ 0,35, mindestens 0,12/0,2), weil ihre UsdPreviewSurface-Variante oft deckend
  oder fast unsichtbar ist (die eigentliche Transparenz steckt nur im OmniGlass-MDL).
* **Texturen:** verkleinert nach Budgetklasse, WebP (Qualität 85, Normalen 90), identische Texturen dedupliziert;
  sehr rauschige Maps werden halbiert, bis sie in ihren Anteil am Dateibudget passen.
* **Kompression:** `EXT_meshopt_compression` + `KHR_mesh_quantization` (three.js: `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`).

## Felder in `assets.json`

| Feld | Bedeutung |
|---|---|
| `id`, `src` (`SR`/`WH`), `path` | Ziel-ID, Datensatz, Ordner im Datensatz |
| `class` | Budgetklasse (`classes`: maxTris, maxTex, maxKB) |
| `keep` | Regex auf USD-Primpfade: diese Teile bleiben eigene Knoten (z. B. Gabeln, Räder) |
| `drop` | Regex: Teile weglassen (z. B. Kabel, Ladeschale) |
| `maxErr` | Obergrenze des Vereinfachungsfehlers in Metern (Schutz feiner Strukturen, z. B. Lochwände) |
| `renormal` | Winkel (°): mitgelieferte USD-Normalen verwerfen und nach Winkel glätten (wenn sie jeden Vertex auftrennen) |
| `smoothAngle` | Auto-Smooth-Winkel nach der Vereinfachung erzwingen (0 = aus) |
| `maxTris`, `maxTex`, `maxKB` | Budget je Asset überschreiben |
| `front` | Blickrichtung der Vorderseite in three.js-Achsen (wird ins Manifest übernommen) |
| `notes` | Hinweis fürs Manifest |

## Lizenzen

Modelle: NVIDIA SimReady (CC BY 4.0) – Namensnennung siehe `assets/CREDITS.md`. Texturen/HDRI: Poly Haven und
ambientCG (CC0). Schriften: Inter und JetBrains Mono (SIL Open Font License 1.1, Lizenztexte in `assets/fonts/`).
