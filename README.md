# PickSim – Lager-Simulator für die Ausbildung

3D-Simulation der Kommissionierung in vier Lagertypen – vom kleinen Fachbodenlager mit Papierliste bis zum Robotik-Center, in dem die Regale zum Picker fahren. Läuft im normalen Browser (Maus & Tastatur) und auf der **Meta Quest 3** (WebXR, Controller).

Zielgruppe: Kaufleute im E-Commerce (und andere kaufmännische Berufe mit Logistikbezug).

**Online spielen:** **https://hf75.github.io/picksim/** – im PC-Browser oder im Browser der Meta Quest 3, ohne Installation und ohne Anmeldung.

---

## Die vier Lager

| | Lager | Lagertyp & Prinzip | Technik beim Picken | Was die Azubis tun | Lernschwerpunkte |
|---|---|---|---|---|---|
| 01 | **Eisenwaren Krämer** (seit 1962) | Fachbodenregallager, Mann-zur-Ware, Festplatzsystem | Papier-Pickliste, Kommissionierwagen | 2 Aufträge drucken, Lagerplätze über Adresse finden (Regal-Fach-Ebene), Menge greifen, Kontrolle am Packtisch; Wahl zwischen unsortierter und wegoptimierter Liste | Lagerplatzadresse, Kommissionierzeit (Weg-/Greif-/Tot-/Basiszeit), Fehlerquellen ohne Scanner, Bestandsdifferenzen, Wegoptimierung |
| 02 | **Großhandel Nordstern** | Palettenregallager, chaotische Lagerung, Reserve-/Pickplätze | MDE-Scanner (Pick-by-Scan), Elektro-Hubwagen | Kartons auf Palette kommissionieren, Lagerplatz scannen, Fehlmenge melden → Nachschub, Ware am Warenausgang übergeben, Staplerverkehr beachten | Barcode/EAN & MDE, Echtzeitbuchung, chaotische Lagerhaltung, Nachschub, Ladungssicherung, Arbeitssicherheit |
| 03 | **Fulfillment-Center „Paketwerk“** | Durchlaufregale, zweistufige/Batch-Kommissionierung | Pick-by-Light, Put-to-Light am Mehrplatzwagen | 6 Online-Bestellungen gleichzeitig picken, Lichtsignalen folgen, danach passende Versandverpackung wählen | Multi-Order-Picking, Pick-by-Light, FIFO, Verpackung & Nachhaltigkeit, Retouren |
| 04 | **Robotik-Center „Orbit“** | Ware-zur-Person mit mobilen Robotern (AMR) | Pick-Station mit Bildschirm, Lichtzeiger, Put-Wall | Roboter bringen Regal-Pods, Azubi pickt im Takt, meldet Fehlteile, beachtet Sicherheitsbereich | Ware-zur-Person, AMR/WMS, Durchsatz (Picks/h), Ergonomie, Vor-/Nachteile der Automatisierung |

Jedes Lager hat ein **Briefing**, **Info-Punkte** (türkise „i“ im Raum – beim Lesen stoppt die Zeit), eine **Auswertung** mit Kennzahlen (Zeit, Positionen pro Stunde, Fehlerquote, Laufweg, Wegzeitanteil) und einen **Wissens-Check** mit 6 Fragen. Die Auswertung vergleicht automatisch mit den anderen Lagern – so wird sichtbar, warum moderne Lager anders arbeiten.

---

## Starten am PC

Am einfachsten: **https://hf75.github.io/picksim/** öffnen (Chrome oder Edge empfohlen).

Ohne Internet, vom eigenen Rechner:

1. Doppelklick auf **`start.bat`** (benötigt [Node.js](https://nodejs.org), LTS-Version).
2. Der Browser öffnet `http://localhost:8080`. Empfohlen: Chrome oder Edge.

Alternativ kann der Ordner auf jeden beliebigen Webserver kopiert werden (es gibt keinen Build-Schritt).

**Direktlinks:** `?lager=lager2` startet direkt ein Lager, `?q=low|medium|high|ultra` erzwingt eine Grafikstufe. Ohne Angabe wählt PickSim die Stufe selbst und senkt sie bei ruckelnder Darstellung automatisch.

## Starten auf der Meta Quest 3

WebXR funktioniert nur über **HTTPS**. Zwei Wege:

**A) Über das Internet (empfohlen für den Unterricht)**
1. In der Quest den **Browser** öffnen und **`hf75.github.io/picksim`** eintippen – am besten gleich als Lesezeichen speichern.
2. Die Startseite meldet „VR-Brille erkannt“. Lager wählen → im Briefing **„In VR starten“**.
3. Beim ersten Start lädt jede Brille etwa 40 MB, danach kommt vieles aus dem Zwischenspeicher.

**B) Ohne Internet im Klassenraum (PC und Quest im selben WLAN)**
1. Auf dem PC **`start-vr.bat`** starten. Beim ersten Mal wird ein Zertifikat erzeugt (benötigt OpenSSL, das bei „Git für Windows“ dabei ist).
2. Im Fenster erscheint eine Adresse wie `https://192.168.1.23:8443`.
3. In der Quest den **Browser** öffnen, Adresse eintippen, die Zertifikatswarnung einmalig mit „Erweitert → Weiter“ bestätigen.
4. Lager wählen → im Briefing **„In VR starten“**.
5. Falls die Quest den PC nicht erreicht: Windows-Firewall-Abfrage für Node.js im **privaten** Netzwerk erlauben.

Die Online-Fassung wird über GitHub Pages aus diesem Repository ausgeliefert. Änderungen erscheinen dort wenige Minuten nach dem Hochladen.

## Steuerung

| Aktion | PC | Meta Quest 3 |
|---|---|---|
| Gehen | W A S D / Pfeiltasten (Shift = schneller) | linker Stick |
| Umsehen / Drehen | Maus | Kopf · rechter Stick (30°-Schritte) |
| Nehmen, Ablegen, Scannen, Drücken | Linksklick oder E | Trigger (Zeigefinger) oder Grifftaste |
| Zurücklegen / Rückgängig | Rechtsklick oder Q | A |
| Bestätigen | Leertaste | X |
| Liste / Gerät | Tab (groß/klein) | Y (ein/aus) |
| Wagen an-/abkoppeln | F | linken Stick drücken |
| Bücken | C (gedrückt halten) | echt in die Knie gehen |
| Pause / Menü | P (ESC gibt die Maus frei) | B |

## Ideen für den Unterricht

- **Tandem:** Eine Person spielt (PC oder VR), eine zweite führt einen Beobachtungsbogen (Wege, Fehler, Zeit) – danach Wechsel.
- **Lernpfad:** Lager 01 → 04 der Reihe nach. Die Auswertung zeigt den Vergleich der Pickleistung; daraus lässt sich die Frage „Warum automatisieren Online-Händler ihre Lager?“ gut diskutieren (Kosten, Investition, Arbeitsplätze, Ergonomie, Ausfallrisiko).
- **Ergebnisse sichern:** In der Auswertung „Ergebnis kopieren“ – der Text kann z. B. in ein Etherpad oder Moodle geklebt werden.
- **Datenschutz:** Es werden keine Daten übertragen. Ergebnisse liegen nur im Browser des jeweiligen Geräts (localStorage).

## Technik

- 3D-Engine: [three.js](https://threejs.org) r187 (lokal im Ordner `vendor/`), WebXR für die Quest.
- Grafik: PBR-Materialien, aus der Szene berechnete Umgebungsreflexionen, Schatten, gebackene Umgebungsverdeckung; am PC bei hoher Grafikstufe zusätzlich GTAO.
- 3D-Modelle: NVIDIA SimReady (OpenUSD), mit Blender 5.2 nach glTF konvertiert und für Browser/Quest optimiert – siehe `tools/assets/`.
- Ordner: `src/core` (Engine, Steuerung, UI), `src/levels` (die Lager), `src/sim` (Kennzahlen), `assets` (Modelle, Texturen, Schriften).

## Lizenzen & Quellen

- 3D-Modelle: **NVIDIA SimReady** auf Hugging Face (`nvidia/simready-assets`, `nvidia/PhysicalAI-SimReady-Warehouse-01`), Lizenz **CC BY 4.0** – Einzelnachweise in [`assets/CREDITS.md`](assets/CREDITS.md).
- Texturen & HDRI: Poly Haven / ambientCG (CC0).
- Schriften: Inter, JetBrains Mono (SIL Open Font License).
- three.js: MIT-Lizenz.
- Alle Firmen, Marken und Produkte in der Simulation sind frei erfunden.
