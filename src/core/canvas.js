// Canvas-Grafiken: EAN-13- und Code-128-Barcodes, Lagerplatz-Etiketten, Verpackungen, Schilder, Papier.
import * as THREE from 'three';
import { roundRect } from './interaction.js';

export const FONT = 'Inter, system-ui, "Segoe UI", Roboto, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';

export function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export function toTexture(canvas, { srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

// ---------------- EAN-13 ----------------
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Prüfziffer für 12 Ziffern */
export function eanCheckDigit(d12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}
/** gültige EAN-13 aus Präfix (z. B. "400") und laufender Nummer */
export function makeEAN(prefix, n) {
  const body = (prefix + String(n).padStart(12 - prefix.length, '0')).slice(0, 12);
  return body + eanCheckDigit(body);
}
export function eanBits(ean) {
  const d = ean.split('').map(Number);
  const par = PARITY[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  return bits;
}
/** EAN-13 zeichnen (inkl. Klarschrift). w = Breite in px */
export function drawEAN(g, ean, x, y, w, h, color = '#000') {
  const bits = eanBits(ean);
  const quiet = 9, total = bits.length + quiet * 2;
  const m = w / total;
  g.fillStyle = color;
  const textH = h * 0.18;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    g.fillRect(x + (quiet + i) * m, y, Math.ceil(m), h - (guard ? textH * 0.45 : textH));
  }
  g.font = `500 ${Math.round(textH * 0.95)}px ${MONO}`;
  g.textBaseline = 'bottom';
  g.textAlign = 'center';
  g.fillText(ean[0], x + quiet * m * 0.45, y + h);
  g.fillText(ean.slice(1, 7), x + (quiet + 3 + 21) * m, y + h);
  g.fillText(ean.slice(7), x + (quiet + 50 + 21) * m, y + h);
}

// ---------------- Code 128 (B) ----------------
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
export function drawCode128(g, text, x, y, w, h, color = '#000') {
  const codes = [104];
  for (const ch of text) codes.push(Math.max(0, Math.min(94, ch.charCodeAt(0) - 32)));
  let sum = 104;
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  const pattern = codes.map(c => C128[c]).join('');
  const modules = pattern.split('').reduce((a, b) => a + Number(b), 0) + 20;
  const m = w / modules;
  let cx = x + 10 * m;
  g.fillStyle = color;
  for (let i = 0; i < pattern.length; i++) {
    const wd = Number(pattern[i]) * m;
    if (i % 2 === 0) g.fillRect(cx, y, wd + 0.3, h);
    cx += wd;
  }
}

// ---------------- Etiketten ----------------
/**
 * Lagerplatz-Etikett (für Traversen/Fachböden). style: 'modern' | 'old' | 'yellow'
 * arrow: 'up' | 'down' | null
 */
export function locationLabel(code, { style = 'modern', arrow = null, sub = '', w = 512, h = 192, barcode = true } = {}) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  if (style === 'old') {
    // Papierstreifen im Etikettenhalter, Schreibmaschinenschrift
    g.fillStyle = '#efe6cf'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,60,30,0.25)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#2b2620';
    g.font = `700 ${h * 0.42}px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(code, 24, h * 0.36);
    if (sub) { g.font = `500 ${h * 0.2}px ${MONO}`; g.fillStyle = '#4a4134'; g.fillText(sub, 26, h * 0.76, w - 40); }
    return c;
  }
  g.fillStyle = style === 'yellow' ? '#f4cf2c' : '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#111';
  const bw = barcode ? w * 0.5 : 0;
  g.font = `800 ${h * 0.4}px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  const tx = arrow ? h * 0.52 : 18;
  g.fillText(code, tx, h * 0.38, w - bw - tx - 10);
  if (sub) { g.font = `500 ${h * 0.17}px ${FONT}`; g.fillStyle = '#333'; g.fillText(sub, tx, h * 0.78, w - bw - tx - 10); }
  if (arrow) {
    g.fillStyle = '#111';
    g.beginPath();
    const ax = h * 0.24, ay = h * 0.5, s = h * 0.17;
    if (arrow === 'up') { g.moveTo(ax, ay - s); g.lineTo(ax + s, ay + s * 0.6); g.lineTo(ax - s, ay + s * 0.6); }
    else { g.moveTo(ax, ay + s); g.lineTo(ax + s, ay - s * 0.6); g.lineTo(ax - s, ay - s * 0.6); }
    g.fill();
  }
  if (barcode) drawCode128(g, code.replace(/\s/g, ''), w - bw - 6, h * 0.12, bw, h * 0.76);
  return c;
}

/** Produktverpackung (Faltschachtel) für prozedurale Artikel: Vorderseite */
export function packagingFront({ brand, name, variant = '', color = '#2563eb', accent = '#fbbf24', icon = 'box', ean = null, w = 512, h = 512, dark = false }) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, color); grd.addColorStop(1, shade(color, -0.25));
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.beginPath(); g.arc(w * 0.85, h * 0.15, w * 0.5, 0, 7); g.fill();
  g.fillStyle = accent; g.fillRect(0, h * 0.72, w, h * 0.06);
  g.fillStyle = dark ? '#111' : '#fff';
  g.font = `900 ${w * 0.11}px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText(brand.toUpperCase(), w * 0.07, h * 0.07, w * 0.86);
  g.font = `700 ${w * 0.085}px ${FONT}`;
  wrapText(g, name, w * 0.07, h * 0.24, w * 0.86, w * 0.1);
  if (variant) { g.font = `500 ${w * 0.06}px ${FONT}`; g.fillText(variant, w * 0.07, h * 0.6, w * 0.86); }
  drawIcon(g, icon, w * 0.72, h * 0.5, w * 0.16, dark ? '#111' : '#fff');
  if (ean) {
    g.fillStyle = '#fff'; roundRect(g, w * 0.52, h * 0.8, w * 0.43, h * 0.17, 8); g.fill();
    drawEAN(g, ean, w * 0.53, h * 0.815, w * 0.41, h * 0.145);
  }
  return c;
}

/** Karton-Seitenetikett (Versand/Lager) */
export function cartonLabel({ title, sku, ean, qty, w = 512, h = 320 }) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#111'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'top';
  g.font = `800 ${h * 0.13}px ${FONT}`; g.fillText(title, 20, 18, w - 40);
  g.font = `500 ${h * 0.085}px ${MONO}`; g.fillText(`Art.-Nr. ${sku}`, 20, h * 0.22);
  if (qty) g.fillText(`Inhalt: ${qty}`, 20, h * 0.32);
  if (ean) drawEAN(g, ean, 20, h * 0.46, w * 0.62, h * 0.48);
  return c;
}

/** Hängeschild / Gangschild */
export function signCanvas(text, { sub = '', bg = '#f5a524', fg = '#111', w = 512, h = 256, font = FONT, radius = 18 } = {}) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = bg; roundRect(g, 0, 0, w, h, radius); g.fill();
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = h * (sub ? 0.5 : 0.62);
  g.font = `800 ${size}px ${font}`;
  while (g.measureText(text).width > w * 0.9 && size > 10) { size -= 2; g.font = `800 ${size}px ${font}`; }
  g.fillText(text, w / 2, sub ? h * 0.4 : h * 0.52);
  if (sub) { g.font = `600 ${h * 0.17}px ${font}`; g.fillText(sub, w / 2, h * 0.8, w * 0.92); }
  return c;
}

export function wrapText(g, text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; }
    else line = t;
  }
  if (line) { g.fillText(line, x, y); y += lh; }
  return y;
}

export function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return '#' + [f(r), f(gg), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** einfache Piktogramme */
export function drawIcon(g, icon, cx, cy, r, color) {
  g.save();
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = r * 0.14; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  switch (icon) {
    case 'screw':
      g.moveTo(cx - r * 0.6, cy - r * 0.7); g.lineTo(cx + r * 0.6, cy - r * 0.7); g.stroke();
      g.beginPath(); g.moveTo(cx, cy - r * 0.7); g.lineTo(cx, cy + r * 0.9); g.stroke();
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(cx - r * 0.3, cy - r * 0.35 + i * r * 0.3); g.lineTo(cx + r * 0.3, cy - r * 0.2 + i * r * 0.3); g.stroke(); }
      break;
    case 'bolt': g.moveTo(cx - r * 0.2, cy - r); g.lineTo(cx + r * 0.4, cy - r * 0.1); g.lineTo(cx, cy - r * 0.1); g.lineTo(cx + r * 0.2, cy + r); g.lineTo(cx - r * 0.4, cy + r * 0.1); g.lineTo(cx, cy + r * 0.1); g.closePath(); g.fill(); break;
    case 'drop': g.moveTo(cx, cy - r); g.quadraticCurveTo(cx + r * 0.9, cy + r * 0.2, cx, cy + r * 0.9); g.quadraticCurveTo(cx - r * 0.9, cy + r * 0.2, cx, cy - r); g.fill(); break;
    case 'leaf': g.ellipse(cx, cy, r * 0.5, r * 0.9, 0.6, 0, 7); g.fill(); break;
    case 'note': g.arc(cx - r * 0.3, cy + r * 0.5, r * 0.3, 0, 7); g.fill(); g.fillRect(cx - r * 0.05, cy - r * 0.8, r * 0.14, r * 1.3); g.fillRect(cx - r * 0.05, cy - r * 0.8, r * 0.6, r * 0.18); break;
    case 'heart': g.moveTo(cx, cy + r * 0.8); g.bezierCurveTo(cx - r * 1.2, cy, cx - r * 0.6, cy - r, cx, cy - r * 0.4); g.bezierCurveTo(cx + r * 0.6, cy - r, cx + r * 1.2, cy, cx, cy + r * 0.8); g.fill(); break;
    case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); g.fill(); break;
    case 'cup': g.rect(cx - r * 0.6, cy - r * 0.5, r * 1.0, r * 1.2); g.stroke(); g.beginPath(); g.arc(cx + r * 0.55, cy + r * 0.05, r * 0.3, -1.2, 1.2); g.stroke(); break;
    case 'game': g.ellipse(cx, cy, r, r * 0.6, 0, 0, 7); g.stroke(); g.fillRect(cx - r * 0.6, cy - r * 0.07, r * 0.4, r * 0.14); g.fillRect(cx - r * 0.47, cy - r * 0.2, r * 0.14, r * 0.4); break;
    case 'phone': g.rect(cx - r * 0.45, cy - r * 0.85, r * 0.9, r * 1.7); g.stroke(); break;
    case 'book': g.rect(cx - r * 0.7, cy - r * 0.8, r * 1.4, r * 1.6); g.stroke(); g.beginPath(); g.moveTo(cx - r * 0.4, cy - r * 0.8); g.lineTo(cx - r * 0.4, cy + r * 0.8); g.stroke(); break;
    default: g.rect(cx - r * 0.7, cy - r * 0.6, r * 1.4, r * 1.2); g.stroke(); g.beginPath(); g.moveTo(cx - r * 0.7, cy - r * 0.6); g.lineTo(cx, cy - r * 0.1); g.lineTo(cx + r * 0.7, cy - r * 0.6); g.stroke();
  }
  g.restore();
}
