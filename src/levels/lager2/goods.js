// LAGER 02 – Artikelstamm (Großhandel), Kartondruck (Canvas-Atlas), Kartongeometrie, Stapelschema
import * as THREE from 'three';
import { makeCanvas, makeEAN, drawEAN, FONT, MONO, shade, drawIcon, wrapText } from '../../core/canvas.js';

// dims = [Länge (entlang Gang), Höhe, Breite (Tiefe)] in m, kg = Gewicht je Karton
export const ARTICLES = [
  { id: 'wasser', name: 'Mineralwasser Classic', pack: '12 × 0,75 l Glas', dims: [0.40, 0.31, 0.30], kg: 16.0, brand: 'Quellgut', color: '#1d4ed8', icon: 'drop', glass: true },
  { id: 'wasserm', name: 'Mineralwasser Medium', pack: '12 × 0,75 l Glas', dims: [0.40, 0.31, 0.30], kg: 16.0, brand: 'Quellgut', color: '#0ea5e9', icon: 'drop', glass: true },
  { id: 'apfel', name: 'Apfelsaft naturtrüb', pack: '6 × 1 l', dims: [0.29, 0.27, 0.19], kg: 6.8, brand: 'Obsthof', color: '#15803d', icon: 'leaf' },
  { id: 'orange', name: 'Orangensaft 100 %', pack: '6 × 1 l', dims: [0.29, 0.27, 0.19], kg: 6.8, brand: 'Obsthof', color: '#ea580c', icon: 'star' },
  { id: 'cola', name: 'Cola-Mix', pack: '12 × 1 l PET', dims: [0.34, 0.32, 0.25], kg: 12.6, brand: 'Fizzo', color: '#b91c1c', icon: 'bolt' },
  { id: 'eistee', name: 'Eistee Pfirsich', pack: '12 × 0,5 l', dims: [0.28, 0.22, 0.21], kg: 6.4, brand: 'Fizzo', color: '#f59e0b', icon: 'cup' },
  { id: 'kaffee', name: 'Kaffee ganze Bohne', pack: '8 × 500 g', dims: [0.30, 0.18, 0.20], kg: 4.2, brand: 'Röstwerk', color: '#5b3a1e', icon: 'cup' },
  { id: 'spaghetti', name: 'Spaghetti Nr. 5', pack: '12 × 500 g', dims: [0.31, 0.20, 0.25], kg: 6.2, brand: 'Nonna Lia', color: '#1e40af', icon: 'heart' },
  { id: 'reis', name: 'Reis Langkorn', pack: '10 × 1 kg', dims: [0.36, 0.20, 0.24], kg: 10.5, brand: 'Goldkorn', color: '#166534', icon: 'leaf' },
  { id: 'mehl', name: 'Weizenmehl Typ 405', pack: '10 × 1 kg', dims: [0.36, 0.20, 0.24], kg: 10.4, brand: 'Mühle Berg', color: '#b45309', icon: 'leaf' },
  { id: 'tomaten', name: 'Tomaten passiert', pack: '12 × 500 g', dims: [0.30, 0.15, 0.22], kg: 6.6, brand: 'Nonna Lia', color: '#dc2626', icon: 'heart' },
  { id: 'hafer', name: 'Haferflocken zart', pack: '12 × 500 g', dims: [0.38, 0.25, 0.26], kg: 6.2, brand: 'Goldkorn', color: '#a16207', icon: 'leaf' },
  { id: 'toilet', name: 'Toilettenpapier 3-lagig', pack: '8 × 8 Rollen', dims: [0.58, 0.42, 0.39], kg: 3.1, brand: 'Softy', color: '#2563eb', icon: 'heart' },
  { id: 'kueche', name: 'Küchenrolle', pack: '6 × 4 Rollen', dims: [0.50, 0.40, 0.36], kg: 2.6, brand: 'Softy', color: '#16a34a', icon: 'heart' },
  { id: 'spuel', name: 'Spülmittel Zitrone', pack: '12 × 500 ml', dims: [0.30, 0.22, 0.22], kg: 6.4, brand: 'Klarglanz', color: '#65a30d', icon: 'drop' },
  { id: 'wasch', name: 'Waschmittel Pulver', pack: '4 × 3 kg', dims: [0.40, 0.30, 0.30], kg: 13.0, brand: 'Weißrein', color: '#0369a1', icon: 'star' },
  { id: 'reiniger', name: 'Allzweckreiniger', pack: '12 × 1 l', dims: [0.34, 0.29, 0.25], kg: 12.5, brand: 'Klarglanz', color: '#0891b2', icon: 'drop' },
  { id: 'seife', name: 'Flüssigseife', pack: '12 × 300 ml', dims: [0.28, 0.20, 0.20], kg: 4.0, brand: 'Klarglanz', color: '#db2777', icon: 'heart' },
  { id: 'muell', name: 'Müllbeutel 60 l', pack: '20 × 10 Stück', dims: [0.40, 0.25, 0.30], kg: 5.6, brand: 'Sackfix', color: '#171717', icon: 'box' },
  { id: 'kekse', name: 'Butterkekse', pack: '20 × 200 g', dims: [0.40, 0.20, 0.30], kg: 4.5, brand: 'Backstube', color: '#ca8a04', icon: 'star' },
  { id: 'mais', name: 'Gemüsemais', pack: '12 × 425 g', dims: [0.30, 0.12, 0.22], kg: 6.4, brand: 'Goldkorn', color: '#eab308', icon: 'leaf' },
  { id: 'zucker', name: 'Zucker fein', pack: '10 × 1 kg', dims: [0.36, 0.18, 0.24], kg: 10.4, brand: 'Mühle Berg', color: '#1d4ed8', icon: 'star' },
  { id: 'tee', name: 'Schwarzer Tee', pack: '12 × 25 Beutel', dims: [0.30, 0.18, 0.24], kg: 1.6, brand: 'Teehaus', color: '#111827', icon: 'cup' },
  { id: 'senf', name: 'Senf mittelscharf', pack: '12 × 200 ml', dims: [0.26, 0.12, 0.20], kg: 3.6, brand: 'Feinkost Saar', color: '#ca8a04', icon: 'drop' },
];

let artNo = 401200;
for (const a of ARTICLES) {
  artNo += 37;
  a.art = String(artNo);
  a.ean = makeEAN('4008', artNo);
  a.cls = a.kg >= 10 ? 'S' : a.kg >= 5 ? 'M' : 'L';
}
export const byId = id => ARTICLES.find(a => a.id === id);
export const CLASS_TEXT = { S: 'SCHWER · unten', M: 'MITTEL', L: 'LEICHT · oben' };

/** Pappe mit Fasern (gleichbleibend per Zufallssaat) */
function cardboard(g, w, h, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.fillStyle = '#b98b58'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const v = rnd();
    g.fillStyle = v > 0.5 ? `rgba(255,236,200,${0.05 + rnd() * 0.05})` : `rgba(80,50,20,${0.04 + rnd() * 0.05})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 6 + rnd() * 30);
  }
  // Kanten dunkler
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, 'rgba(60,35,10,0.25)'); gr.addColorStop(0.06, 'rgba(60,35,10,0)'); gr.addColorStop(0.94, 'rgba(60,35,10,0)'); gr.addColorStop(1, 'rgba(60,35,10,0.25)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}

/** Kartondruck (Flexodruck-Optik) 768 × 576. Oberes Band (10 %) bleibt unbedruckt (für Deckel/Boden). */
export function cartonCanvas(a, idx = 0) {
  const W = 768, H = 576;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  cardboard(g, W, H, idx + 3);
  const top = 58;
  // Klebeband-Streifen oben
  g.fillStyle = 'rgba(200,170,120,0.55)'; g.fillRect(W * 0.42, 0, W * 0.16, top + 30);
  // Marke & Name (einfarbiger Druck)
  const ink = a.color;
  g.fillStyle = ink; g.globalAlpha = 0.92;
  g.font = `900 64px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText(a.brand.toUpperCase(), 40, top + 30, W * 0.62);
  g.fillRect(40, top + 104, W * 0.55, 8);
  g.font = `800 50px ${FONT}`;
  const y = wrapText(g, a.name, 40, top + 128, W * 0.6, 56);
  g.font = `700 40px ${FONT}`;
  g.fillText(a.pack, 40, y + 8);
  drawIcon(g, a.icon, W * 0.8, top + 120, 70, ink);
  g.globalAlpha = 1;
  // Handhabungssymbole
  g.strokeStyle = '#2a1d10'; g.fillStyle = '#2a1d10'; g.lineWidth = 6;
  const sx = W - 230, sy = H - 250;
  for (const dx of [0, 34]) { g.beginPath(); g.moveTo(sx + dx, sy + 60); g.lineTo(sx + dx, sy + 10); g.stroke(); g.beginPath(); g.moveTo(sx + dx - 12, sy + 22); g.lineTo(sx + dx, sy + 4); g.lineTo(sx + dx + 12, sy + 22); g.fill(); }
  g.fillRect(sx - 16, sy + 64, 66, 6);
  // Schirm (trocken lagern)
  g.beginPath(); g.arc(sx + 120, sy + 34, 26, Math.PI, 0); g.fill();
  g.beginPath(); g.moveTo(sx + 120, sy + 34); g.lineTo(sx + 120, sy + 64); g.stroke();
  if (a.glass) { g.beginPath(); g.moveTo(sx + 170, sy + 6); g.lineTo(sx + 200, sy + 6); g.lineTo(sx + 192, sy + 40); g.lineTo(sx + 178, sy + 40); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(sx + 185, sy + 40); g.lineTo(sx + 185, sy + 62); g.stroke(); }
  // Lageretikett (weiß) mit EAN und MHD
  const lx = 40, ly = H - 200, lw = 420, lh = 170;
  g.fillStyle = '#fbfaf5'; g.fillRect(lx, ly, lw, lh);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.strokeRect(lx, ly, lw, lh);
  g.fillStyle = '#111'; g.font = `700 26px ${MONO}`; g.fillText(`ART ${a.art}`, lx + 14, ly + 10);
  g.font = `500 22px ${MONO}`; g.fillText(`MHD ${mhdText(idx)}`, lx + 220, ly + 13);
  drawEAN(g, a.ean, lx + 10, ly + 48, lw - 20, lh - 56);
  return c;
}

export function mhdText(i) {
  const d = new Date(); d.setMonth(d.getMonth() + 5 + (i % 9)); d.setDate(1 + (i * 7) % 27);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Reserve-Palette: Seitenansicht vieler Kartons unter Stretchfolie, 512 × 512 */
export function blockCanvas(a, cartonCanvasRef) {
  const W = 512, H = 512;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const [L, Hh] = a.dims;
  const cols = Math.max(2, Math.round(1.2 / L)), rows = Math.max(2, Math.round(1.25 / Hh));
  const cw = W / cols, ch = (H - 30) / rows;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    g.drawImage(cartonCanvasRef, 0, 58, 768, 518, k * cw, 30 + r * ch, cw - 2, ch - 2);
    g.fillStyle = 'rgba(40,25,10,0.35)'; g.fillRect(k * cw + cw - 3, 30 + r * ch, 3, ch); g.fillRect(k * cw, 30 + r * ch + ch - 3, cw, 3);
  }
  // Oberes Band: Deckelansicht (Pappe)
  cardboard(g, W, 30, 9);
  // Stretchfolie: Glanzstreifen
  const sh = g.createLinearGradient(0, 0, W, H);
  sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(0.45, 'rgba(255,255,255,0.02)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.22)'); sh.addColorStop(0.55, 'rgba(255,255,255,0.03)'); sh.addColorStop(1, 'rgba(255,255,255,0.12)');
  g.fillStyle = sh; g.fillRect(0, 30, W, H - 30);
  for (let y = 40; y < H; y += 38) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, y, W, 2); }
  return c;
}

/**
 * Einheitsbox für Kartons. ±X-Flächen (lange Seiten, zum Gang) zeigen den ganzen Zellinhalt,
 * ±Z-Flächen (Stirnseiten) den Mittelteil, ±Y den unbedruckten Pappstreifen.
 */
export function cartonGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv;
  const set = (face, u0, v0, u1, v1) => {
    for (let i = 0; i < 4; i++) { const k = face * 4 + i; uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0)); }
  };
  set(0, 0, 0, 1, 0.9); set(1, 0, 0, 1, 0.9);           // ±X: Druck (ohne Band)
  set(2, 0.02, 0.91, 0.4, 0.99); set(3, 0.02, 0.91, 0.4, 0.99); // ±Y: Pappe
  set(4, 0.25, 0.2, 0.75, 0.9); set(5, 0.25, 0.2, 0.75, 0.9); // ±Z: Mittelteil
  return g;
}

/** Reserveblock: alle 4 Seiten Druck, Deckel = Pappband */
export function blockGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv;
  const set = (face, u0, v0, u1, v1) => { for (let i = 0; i < 4; i++) { const k = face * 4 + i; uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0)); } };
  set(0, 0, 0, 1, 0.94); set(1, 0, 0, 1, 0.94); set(4, 0.2, 0, 0.8, 0.94); set(5, 0.2, 0, 0.8, 0.94);
  set(2, 0.05, 0.95, 0.95, 0.995); set(3, 0.05, 0.95, 0.95, 0.995);
  return g;
}

/** Stapelschema auf einer Europalette (1,2 m entlang Gang = Z, 0,8 m tief = X) */
export function stackLayout(a, maxH = 1.3) {
  const [L, H, W] = a.dims;
  const nz = Math.max(1, Math.floor(1.18 / L)), nx = Math.max(1, Math.floor(0.78 / W));
  const per = nz * nx;
  const layers = Math.max(1, Math.floor(maxH / H));
  return {
    per, layers, max: per * layers,
    pos(i) {
      const layer = Math.floor(i / per), k = i % per;
      const ix = k % nx, iz = Math.floor(k / nx);
      return new THREE.Vector3((ix - (nx - 1) / 2) * W * 1.01, layer * H + H / 2, (iz - (nz - 1) / 2) * L * 1.01);
    },
  };
}

/** prozedurale Europalette (Bretter + Klötze), 1,2 × 0,144 × 0,8 m; lange Seite entlang Z */
export function palletGeometry(mergeGeometries) {
  const parts = [];
  const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); return b; };
  // Bodenbretter (3) entlang Z
  for (const x of [-0.33, 0, 0.33]) parts.push(box(0.1, 0.022, 1.2, x, 0.011, 0));
  // Klötze 3 × 3
  for (const x of [-0.33, 0, 0.33]) for (const z of [-0.54, 0, 0.54]) parts.push(box(0.1, 0.078, 0.145, x, 0.022 + 0.039, z));
  // Querbretter (3) entlang X
  for (const z of [-0.54, 0, 0.54]) parts.push(box(0.8, 0.022, 0.145, 0, 0.1 + 0.011, z));
  // Deckbretter (5) entlang Z
  for (const x of [-0.35, -0.175, 0, 0.175, 0.35]) parts.push(box(x === 0 ? 0.145 : 0.1, 0.022, 1.2, x, 0.122 + 0.011, 0));
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return g;
}
