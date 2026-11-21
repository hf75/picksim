// Lager 03 – Sortiment, Batch-Aufträge und Versandverpackungen des Fulfillment-Centers „Paketwerk“
import { makeEAN } from '../../core/canvas.js';

// fiktive Marken (keine echten Markennamen)
export const BRANDS = ['Morgentau', 'Fjordling', 'Zitronia', 'Wolkenweich', 'Bitkiste', 'Pixelfuchs', 'Teewald', 'Kaffeeklang', 'Glühwurm',
  'Kranichhof', 'Sonnenkind', 'Funkelstein', 'Nordwerk', 'Bärenruh', 'Klangwerk', 'Seidenfuchs', 'Haferglück', 'Lumora'];

// Kategorien: Farbe, Piktogramm, Markenauswahl
const CAT = {
  food: { color: '#b45309', accent: '#fde68a', icon: 'leaf', brands: ['Haferglück', 'Morgentau', 'Teewald', 'Kaffeeklang'] },
  drug: { color: '#0e7490', accent: '#a5f3fc', icon: 'drop', brands: ['Wolkenweich', 'Seidenfuchs', 'Zitronia'] },
  elec: { color: '#1e293b', accent: '#38bdf8', icon: 'bolt', brands: ['Bitkiste', 'Lumora', 'Nordwerk'] },
  toy: { color: '#7c3aed', accent: '#fbbf24', icon: 'star', brands: ['Pixelfuchs', 'Funkelstein', 'Sonnenkind'] },
  home: { color: '#be123c', accent: '#fecdd3', icon: 'heart', brands: ['Bärenruh', 'Glühwurm', 'Kranichhof'] },
  office: { color: '#1d4ed8', accent: '#bfdbfe', icon: 'book', brands: ['Fjordling', 'Klangwerk'] },
  pet: { color: '#15803d', accent: '#bbf7d0', icon: 'heart', brands: ['Kranichhof', 'Bärenruh'] },
  media: { color: '#334155', accent: '#e2e8f0', icon: 'book', brands: ['Klangwerk', 'Fjordling'] },
};
export const CAT_NAMES = { food: 'Lebensmittel', drug: 'Drogerie', elec: 'Elektronik', toy: 'Spielwaren', home: 'Haushalt', office: 'Büro', pet: 'Tierbedarf', media: 'Bücher & Medien' };

// [Name, Kategorie, Maße in m (Breite, Höhe, Tiefe – Vorderseite = Breite×Höhe), Variante, Modell-ID (optional)]
const ITEMS = [
  ['Bio-Müsli Beere 750 g', 'food', [0.19, 0.27, 0.07]], ['Haferkekse 250 g', 'food', [0.16, 0.06, 0.06]], ['Grüner Tee 20 Btl.', 'food', [0.13, 0.08, 0.07]],
  ['Espresso Bohnen 1 kg', 'food', [0.13, 0.25, 0.08]], ['Dinkel-Cracker', 'food', [0.18, 0.12, 0.05]], ['Nussmix 200 g', 'food', [0.14, 0.2, 0.05]],
  ['Fruchtgummi 300 g', 'food', [0.15, 0.2, 0.04]], ['Zartbitter-Schokolade', 'food', [0.16, 0.08, 0.015]], ['Blütenhonig 500 g', 'food', [0.08, 0.12, 0.08]],
  ['Schoko-Cookies Dose', 'food', [0.2, 0.08, 0.13], '', 'p_cookies'], ['Orangensaft 1 l', 'food', [0.09, 0.2, 0.06], '', 'p_juice'],
  ['Duschgel Minze', 'drug', [0.07, 0.2, 0.04]], ['Handcreme 75 ml', 'drug', [0.06, 0.15, 0.035]], ['Zahnpasta Kräuter', 'drug', [0.19, 0.045, 0.04]],
  ['Shampoo Repair', 'drug', [0.08, 0.21, 0.05]], ['Sonnencreme LSF 30', 'drug', [0.07, 0.17, 0.045]], ['Deo Roller', 'drug', [0.05, 0.12, 0.05]],
  ['Bambus-Zahnbürsten 4er', 'drug', [0.1, 0.21, 0.025]], ['Lippenpflege 2er', 'drug', [0.07, 0.1, 0.02]], ['Einweghandschuhe 100 St.', 'drug', [0.24, 0.12, 0.13], '', 'p_glovebox'],
  ['USB-C-Kabel 1 m', 'elec', [0.1, 0.16, 0.03]], ['Powerbank 10.000 mAh', 'elec', [0.11, 0.16, 0.04]], ['Bluetooth-Kopfhörer', 'elec', [0.19, 0.22, 0.08]],
  ['Ladegerät 20 W', 'elec', [0.08, 0.12, 0.05]], ['Funkmaus', 'elec', [0.11, 0.16, 0.06]], ['LED-Lampe E27', 'elec', [0.07, 0.12, 0.07]],
  ['Smart-Steckdose', 'elec', [0.09, 0.12, 0.08]], ['HDMI-Kabel 2 m', 'elec', [0.12, 0.18, 0.04]], ['Speicherkarte 128 GB', 'elec', [0.08, 0.11, 0.01]],
  ['Autolampe H7', 'elec', [0.09, 0.12, 0.06], '', 'p_bulb'], ['Alkoholmarker 12er', 'office', [0.2, 0.06, 0.15], '', 'p_markers'],
  ['Puzzle 1000 Teile', 'toy', [0.37, 0.27, 0.06]], ['Kartenspiel', 'toy', [0.09, 0.13, 0.03]], ['Bausteine-Set', 'toy', [0.26, 0.19, 0.07]],
  ['Jonglierbälle 3er', 'toy', [0.2, 0.08, 0.07]], ['Straßenkreide 12 Farben', 'toy', [0.17, 0.14, 0.04]], ['Zauberwürfel', 'toy', [0.07, 0.07, 0.07]],
  ['Spültücher 3er', 'home', [0.12, 0.18, 0.04]], ['Duftkerze Vanille', 'home', [0.1, 0.12, 0.1]], ['Teelichter 24er', 'home', [0.16, 0.06, 0.1]],
  ['Kabelbinder bunt', 'home', [0.1, 0.22, 0.02]], ['Küchenwaage digital', 'home', [0.22, 0.05, 0.17]], ['Messbecher 1 l', 'home', [0.13, 0.16, 0.13]],
  ['Arbeitshandschuhe Leder', 'home', [0.13, 0.24, 0.04], '', 'p_gloves'], ['Werkzeugkoffer', 'home', [0.36, 0.28, 0.09], '', 'p_toolcase'], ['Schutzhelm', 'home', [0.28, 0.17, 0.24], '', 'p_helmet'],
  ['Notizbuch A5', 'office', [0.15, 0.21, 0.015]], ['Gelstifte 10er', 'office', [0.1, 0.17, 0.015]], ['Textmarker 4er', 'office', [0.1, 0.14, 0.02]],
  ['Haftnotizen 6 Blöcke', 'office', [0.08, 0.08, 0.05]], ['Tacker mit Klammern', 'office', [0.16, 0.07, 0.05]], ['Briefumschläge 50 St.', 'office', [0.23, 0.12, 0.04]],
  ['Katzensnacks Lachs', 'pet', [0.11, 0.16, 0.04]], ['Hundekekse 500 g', 'pet', [0.16, 0.24, 0.06]], ['Kauknochen 3er', 'pet', [0.08, 0.2, 0.04]],
  ['Roman „Nebelküste“', 'media', [0.13, 0.2, 0.03]], ['Kochbuch „Heimatküche“', 'media', [0.2, 0.26, 0.025]], ['Sachbuch Logistik', 'media', [0.17, 0.24, 0.03]],
];

/** Sortiment für die Fachplätze (Anzahl = Lanes) */
export function makeAssortment(count) {
  const skus = [];
  let n = 0;
  const variants = ['', 'Vorteilspack', 'Nachfüllpack', 'Geschenkset', 'Mini', 'XL'];
  while (skus.length < count) {
    const [name, cat, dims, , model] = ITEMS[n % ITEMS.length];
    const round = Math.floor(n / ITEMS.length);
    const c = CAT[cat];
    const brand = c.brands[(n * 7 + round) % c.brands.length];
    const variant = round > 0 ? variants[round % variants.length] : '';
    const art = 300100 + n * 13;
    skus.push({
      id: 'P' + art, art: String(art), ean: makeEAN('4012', art), cat, brand,
      name: variant ? `${name} ${variant}` : name, shortName: name,
      dims: dims.map(v => v * (variant === 'XL' ? 1.2 : variant === 'Mini' ? 0.8 : 1)),
      color: c.color, accent: c.accent, icon: c.icon, model: round === 0 ? model : undefined,
    });
    n++;
  }
  return skus;
}

/** Batch mit 6 Online-Aufträgen (Namen beziehen sich auf das Sortiment) */
export const BATCH = {
  no: 'B-2611-07',
  orders: [
    { no: '1001', customer: 'Lena K., Berlin', lines: [['Gelstifte 10er', 1], ['Haftnotizen 6 Blöcke', 2]] },
    { no: '1002', customer: 'Murat Y., Saarbrücken', lines: [['Powerbank 10.000 mAh', 1], ['USB-C-Kabel 1 m', 2]] },
    { no: '1003', customer: 'Fam. Weber, Köln', lines: [['Puzzle 1000 Teile', 1], ['Kartenspiel', 1]] },
    { no: '1004', customer: 'Bauhof Meier, Trier', lines: [['Schutzhelm', 1], ['Arbeitshandschuhe Leder', 1]] },
    { no: '1005', customer: 'Sophie R., Mainz', lines: [['Duftkerze Vanille', 1], ['Teelichter 24er', 2]] },
    { no: '1006', customer: 'Tierheim Pfötchen', lines: [['Katzensnacks Lachs', 2], ['Kauknochen 3er', 1]] },
  ],
};

/** Versandverpackungen (Innenmaße in m) */
export const PACKAGING = [
  { id: 'bag', name: 'Versandtasche', dims: [0.35, 0.25, 0.06], bag: true, cost: 0.18, label: '35 × 25 cm, flach (max. 6 cm)' },
  { id: 'S', name: 'Karton S', dims: [0.2, 0.15, 0.1], cost: 0.32, label: '20 × 15 × 10 cm' },
  { id: 'M', name: 'Karton M', dims: [0.3, 0.2, 0.15], cost: 0.48, label: '30 × 20 × 15 cm' },
  { id: 'L', name: 'Karton L', dims: [0.4, 0.3, 0.25], cost: 0.85, label: '40 × 30 × 25 cm' },
];

const vol = d => d[0] * d[1] * d[2];
const sortDesc = d => [...d].sort((a, b) => b - a);

/** passt eine Artikelliste (Maße) in die Verpackung? */
export function fits(itemsDims, pack) {
  const total = itemsDims.reduce((s, d) => s + vol(d), 0);
  if (pack.bag) {
    const inner = [pack.dims[0] - 0.02, pack.dims[1] - 0.02];
    for (const d of itemsDims) {
      const s = sortDesc(d);
      if (s[2] > pack.dims[2] + 1e-6) return false;
      if (!(s[0] <= inner[0] && s[1] <= inner[1])) return false;
    }
    return total <= vol(pack.dims) * 0.8;
  }
  const P = sortDesc(pack.dims);
  for (const d of itemsDims) {
    const s = sortDesc(d);
    if (s[0] > P[0] + 1e-6 || s[1] > P[1] + 1e-6 || s[2] > P[2] + 1e-6) return false;
  }
  // Stapelbarkeit grob: Gesamtvolumen ≤ 75 % des Kartons
  return total <= vol(pack.dims) * 0.75;
}

export function fillRate(itemsDims, pack) {
  return itemsDims.reduce((s, d) => s + vol(d), 0) / vol(pack.dims);
}

/** günstigste passende Verpackung (Versandtasche vor Karton S vor M vor L) */
export function bestPackaging(itemsDims) {
  const ok = PACKAGING.filter(p => fits(itemsDims, p)).sort((a, b) => a.cost - b.cost);
  return ok[0] || PACKAGING[PACKAGING.length - 1];
}

export const volume = vol;
