// Übersicht der Lagerwelten (Reihenfolge = Lernpfad vom einfachen zum hochautomatisierten Lager)
export const LEVELS = [
  {
    id: 'lager1', file: 'lager1.js', num: '01', era: 'seit 1962',
    title: 'Eisenwaren Krämer',
    kind: 'Fachbodenregallager',
    tag: 'Kleiner Familienbetrieb: Papier-Pickliste, Kommissionierwagen, feste Lagerplätze. Finde die Ware über die Lagerplatzadresse.',
    chips: [['Mann-zur-Ware', 'accent'], ['Pick-by-Paper'], ['Festplatzsystem']],
    duration: '10–15 Min.',
    palette: ['#3b2a1e', '#a8743f', '#e8c48a'],
  },
  {
    id: 'lager2', file: 'lager2.js', num: '02', era: 'Großhandel',
    title: 'Großhandel Nordstern',
    kind: 'Palettenregallager',
    tag: 'Große Halle mit Palettenregalen und Staplerverkehr. Kommissioniere Kartons mit Scanner (MDE) auf eine Palette.',
    chips: [['Pick-by-Scan', 'accent'], ['MDE & Barcode'], ['Chaotische Lagerung'], ['Arbeitssicherheit']],
    duration: '10–15 Min.',
    palette: ['#10223f', '#1f4fa3', '#f08a24'],
  },
  {
    id: 'lager3', file: 'lager3.js', num: '03', era: 'E-Commerce',
    title: 'Fulfillment-Center „Paketwerk“',
    kind: 'Durchlaufregale & Pick-by-Light',
    tag: 'Online-Bestellungen im Akkord: mehrere Aufträge gleichzeitig kommissionieren, Lichter weisen den Weg, danach richtig verpacken.',
    chips: [['Multi-Order-Picking', 'accent'], ['Pick-by-Light'], ['Put-to-Light'], ['Verpacken']],
    duration: '12–18 Min.',
    palette: ['#0f2a2a', '#14b8a6', '#d1fae5'],
  },
  {
    id: 'lager4', file: 'lager4.js', num: '04', era: 'Zukunft',
    title: 'Robotik-Center „Orbit“',
    kind: 'Ware-zur-Person mit Robotern',
    tag: 'Die Regale kommen zu dir: Roboter bringen Regal-Pods an deine Station. Du pickst – das System steuert alles andere.',
    chips: [['Ware-zur-Person', 'teal'], ['Mobile Roboter (AMR)'], ['Pick-Station'], ['Kennzahlen']],
    duration: '8–12 Min.',
    palette: ['#0b1020', '#4f46e5', '#22d3ee'],
  },
];

export function levelById(id) { return LEVELS.find(l => l.id === id); }
export function nextLevel(id) { const i = LEVELS.findIndex(l => l.id === id); return LEVELS[i + 1] || null; }
