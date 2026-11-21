// Lager 4 – Sortiment eines Online-Händlers (fiktive Marken) + Verpackungsgrafiken
import { makeCanvas, makeEAN, drawEAN, drawIcon, shade, wrapText, FONT, MONO } from '../../core/canvas.js';
import { roundRect } from '../../core/interaction.js';

export const RNG = s => () => (s = (s * 16807) % 2147483647) / 2147483647;

// [Name, Variante, Marke, Kategorie, Farbe, Akzent, Icon, Maße b×h×t (m), Modell-ID für die Hand (optional)]
const RAW = [
  ['Bluetooth-Kopfhörer', 'schwarz', 'Lumio', 'Elektronik', '#111827', '#22d3ee', 'note', [0.16, 0.19, 0.07]],
  ['USB-C Ladekabel', '1 m', 'Volta', 'Elektronik', '#1d4ed8', '#e5e7eb', 'bolt', [0.1, 0.16, 0.025]],
  ['Powerbank 10 000 mAh', 'silber', 'Volta', 'Elektronik', '#334155', '#facc15', 'bolt', [0.09, 0.15, 0.03]],
  ['Funkmaus', 'ergonomisch', 'Lumio', 'Elektronik', '#0f172a', '#a78bfa', 'game', [0.11, 0.14, 0.06]],
  ['Smartphone-Hülle', 'transparent', 'Kiwako', 'Elektronik', '#0ea5e9', '#f8fafc', 'phone', [0.1, 0.18, 0.025]],
  ['Speicherkarte 128 GB', 'microSD', 'Volta', 'Elektronik', '#b91c1c', '#fef08a', 'star', [0.07, 0.1, 0.012]],
  ['Mini-Lautsprecher', 'wasserfest', 'Lumio', 'Elektronik', '#065f46', '#34d399', 'note', [0.12, 0.12, 0.09]],
  ['HDMI-Kabel', '2 m', 'Volta', 'Elektronik', '#111827', '#f97316', 'bolt', [0.12, 0.17, 0.03]],
  ['LED-Leselampe', 'Clip', 'Lumio', 'Elektronik', '#f59e0b', '#1f2937', 'star', [0.09, 0.2, 0.06]],
  ['Kaffeebecher', 'Steinzeug 350 ml', 'Hausglück', 'Haushalt', '#92400e', '#fde68a', 'cup', [0.12, 0.13, 0.12]],
  ['Trinkflasche', 'Edelstahl 0,75 l', 'Aqua Viva', 'Haushalt', '#0e7490', '#cffafe', 'drop', [0.08, 0.27, 0.08]],
  ['Küchenwaage', 'digital', 'Hausglück', 'Haushalt', '#f1f5f9', '#ef4444', 'box', [0.2, 0.05, 0.16], null, true],
  ['Duftkerze', 'Vanille', 'Tausendschön', 'Haushalt', '#fbcfe8', '#9d174d', 'heart', [0.09, 0.11, 0.09], null, true],
  ['Teelichter', '30 Stück', 'Tausendschön', 'Haushalt', '#fef3c7', '#b45309', 'star', [0.13, 0.08, 0.13], null, true],
  ['Vorratsglas', '1 l', 'Hausglück', 'Haushalt', '#d1fae5', '#047857', 'leaf', [0.11, 0.17, 0.11]],
  ['Schneidebrett', 'Bambus', 'Hausglück', 'Haushalt', '#a16207', '#fef9c3', 'leaf', [0.18, 0.24, 0.02]],
  ['Puzzle 1000 Teile', 'Leuchtturm', 'Spielzeit', 'Spielwaren', '#1e3a8a', '#fbbf24', 'game', [0.2, 0.14, 0.06]],
  ['Kartenspiel', 'Familienspaß', 'Spielzeit', 'Spielwaren', '#dc2626', '#fde047', 'star', [0.07, 0.1, 0.03]],
  ['Bausteine-Set', '250 Teile', 'Brixa', 'Spielwaren', '#facc15', '#1d4ed8', 'box', [0.19, 0.15, 0.06]],
  ['Plüschfuchs', '30 cm', 'Fennek', 'Spielwaren', '#ea580c', '#fff7ed', 'heart', [0.14, 0.2, 0.1]],
  ['Denkwürfel', '3×3', 'Brixa', 'Spielwaren', '#16a34a', '#fef08a', 'game', [0.07, 0.07, 0.07]],
  ['Roman', 'Taschenbuch', 'Papyrus & Co.', 'Bücher', '#1f2937', '#fbbf24', 'book', [0.12, 0.19, 0.03]],
  ['Kochbuch', 'Schnelle Küche', 'Papyrus & Co.', 'Bücher', '#b45309', '#fef3c7', 'book', [0.19, 0.24, 0.025]],
  ['Notizbuch A5', 'gepunktet', 'Papyrus & Co.', 'Bücher', '#0f766e', '#ccfbf1', 'book', [0.15, 0.21, 0.02]],
  ['Malbuch', 'Tiere', 'Spielzeit', 'Bücher', '#7c3aed', '#fde68a', 'book', [0.2, 0.26, 0.012]],
  ['Handcreme', '75 ml', 'Tausendschön', 'Drogerie', '#fce7f3', '#be185d', 'drop', [0.05, 0.16, 0.035]],
  ['Sonnencreme LSF 50', '200 ml', 'Aqua Viva', 'Drogerie', '#fde047', '#ea580c', 'star', [0.06, 0.19, 0.04]],
  ['Shampoo', 'Kräuter 300 ml', 'Tausendschön', 'Drogerie', '#dcfce7', '#15803d', 'leaf', [0.07, 0.21, 0.045]],
  ['Zahnbürsten', '2er-Pack', 'Aqua Viva', 'Drogerie', '#e0f2fe', '#0284c7', 'drop', [0.08, 0.22, 0.025]],
  ['Duschgel', 'Meeresbrise', 'Aqua Viva', 'Drogerie', '#bae6fd', '#0369a1', 'drop', [0.07, 0.2, 0.045]],
  ['Springseil', 'verstellbar', 'Sprungfeder', 'Sport', '#e11d48', '#fecdd3', 'heart', [0.12, 0.16, 0.05]],
  ['Yogablock', 'Kork', 'Sprungfeder', 'Sport', '#a16207', '#fef3c7', 'leaf', [0.15, 0.1, 0.23], null, true],
  ['Fahrradlicht-Set', 'LED', 'Volta', 'Sport', '#111827', '#ef4444', 'bolt', [0.12, 0.17, 0.05]],
  ['Tischtennisbälle', '6 Stück', 'Sprungfeder', 'Sport', '#f97316', '#fff7ed', 'star', [0.11, 0.09, 0.05]],
  ['Marker-Set', '12 Farben', 'Papyrus & Co.', 'Büro', '#4f46e5', '#fde047', 'note', [0.16, 0.12, 0.03], 'p_markers'],
  ['Kugelschreiber', '10er-Pack', 'Papyrus & Co.', 'Büro', '#1e40af', '#dbeafe', 'note', [0.06, 0.17, 0.02]],
  ['Haftnotizen', '6 Blöcke', 'Papyrus & Co.', 'Büro', '#facc15', '#ca8a04', 'note', [0.08, 0.08, 0.05]],
  ['Butterkekse', 'Dose 400 g', 'Hausglück', 'Lebensmittel', '#dc2626', '#fde68a', 'heart', [0.2, 0.08, 0.13], 'p_cookies', true],
  ['Orangensaft', '1 l', 'Aqua Viva', 'Lebensmittel', '#f59e0b', '#16a34a', 'drop', [0.07, 0.2, 0.07], 'p_juice'],
  ['Einweghandschuhe', '100 Stück', 'Kiwako', 'Drogerie', '#38bdf8', '#e0f2fe', 'heart', [0.13, 0.07, 0.24], 'p_glovebox', true],
  ['Arbeitshandschuhe', 'Leder Gr. 10', 'Kiwako', 'Werkzeug', '#78350f', '#fde68a', 'heart', [0.12, 0.22, 0.04], 'p_gloves'],
  ['Halogenlampe H7', '12 V', 'Volta', 'Werkzeug', '#1f2937', '#fbbf24', 'bolt', [0.06, 0.1, 0.05], 'p_bulb'],
  ['Kombizange', '180 mm', 'Kiwako', 'Werkzeug', '#b91c1c', '#fef2f2', 'star', [0.08, 0.22, 0.03], 'p_pliers'],
  ['Schraubendreher', 'PH2', 'Kiwako', 'Werkzeug', '#ea580c', '#fff7ed', 'star', [0.05, 0.24, 0.03], 'p_screwdriver'],
];

export function makeProducts() {
  return RAW.map(([name, variant, brand, cat, color, accent, icon, size, model, flat], i) => ({
    id: 'P' + String(4100 + i * 7),
    name, variant, brand, cat, color, accent, icon, size, model: model || null, flat: !!flat,
    ean: makeEAN('4061', 4100 + i * 7),
  }));
}

/** Verpackungsfront 256×256 */
export function productCanvas(p, size = 256) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const s = size / 256;
  const grd = g.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, p.color); grd.addColorStop(1, shade(p.color, -0.3));
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.arc(size * 0.86, size * 0.12, size * 0.55, 0, 7); g.fill();
  g.fillStyle = p.accent; g.fillRect(0, size * 0.7, size, size * 0.06);
  const light = isLight(p.color);
  const fg = light ? '#111827' : '#ffffff';
  g.fillStyle = fg; g.textBaseline = 'top'; g.textAlign = 'left';
  g.font = `900 ${28 * s}px ${FONT}`; g.fillText(p.brand.toUpperCase(), 14 * s, 12 * s, 228 * s);
  g.font = `700 ${23 * s}px ${FONT}`;
  wrapText(g, p.name, 14 * s, 50 * s, 160 * s, 26 * s);
  g.font = `500 ${16 * s}px ${FONT}`; g.globalAlpha = 0.85; g.fillText(p.variant, 14 * s, 146 * s, 228 * s); g.globalAlpha = 1;
  drawIcon(g, p.icon, 196 * s, 112 * s, 34 * s, fg);
  g.fillStyle = '#fff'; roundRect(g, 120 * s, 196 * s, 126 * s, 52 * s, 6 * s); g.fill();
  drawEAN(g, p.ean, 122 * s, 199 * s, 122 * s, 46 * s);
  return c;
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * gg + 0.114 * b > 160;
}

/** QR-ähnliche Bodenmarke (Fiducial) – mehrere Varianten in einem Canvas (4×4) */
export function fiducialCanvas(seed = 7) {
  const rnd = RNG(seed);
  const c = makeCanvas(512, 512), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  for (let v = 0; v < 16; v++) {
    const ox = (v % 4) * 128, oy = Math.floor(v / 4) * 128;
    g.fillStyle = '#f4f4f0'; g.fillRect(ox + 4, oy + 4, 120, 120);
    g.fillStyle = '#0b0d10';
    const n = 7, cell = 104 / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const finder = (x < 2 && y < 2) || (x > n - 3 && y < 2) || (x < 2 && y > n - 3);
      if (finder || rnd() < 0.45) g.fillRect(ox + 12 + x * cell, oy + 12 + y * cell, cell + 0.5, cell + 0.5);
    }
  }
  return c;
}

export { FONT, MONO };
