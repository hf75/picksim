// LAGER 02 – Bildschirm des MDE (mobiles Datenerfassungsgerät) im Stil eines robusten Android-Scanners
import { FONT, MONO } from '../../core/canvas.js';
import { roundRect } from '../../core/interaction.js';
import { CLASS_TEXT } from './goods.js';

const C = { bg: '#0b1220', card: '#111c30', line: '#1f2b44', text: '#e8eef8', mute: '#8ea0bd', accent: '#38bdf8', ok: '#34d399', warn: '#fbbf24', err: '#f87171', brand: '#f08a24' };

/**
 * s = { phase, order, lines, idx, scanned, flash:{text,type,t}, xr, now }
 * phase: 'login' | 'goto' | 'take' | 'short' | 'wait' | 'deliver' | 'wrap' | 'done'
 */
export function drawMDE(g, W, H, s) {
  g.save();
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  // Statusleiste
  g.fillStyle = '#060a13'; g.fillRect(0, 0, W, 46);
  g.fillStyle = C.brand; g.font = `800 22px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText('NORDSTERN WMS', 18, 24);
  g.fillStyle = C.mute; g.font = `600 18px ${MONO}`; g.textAlign = 'center';
  g.fillText('MDE-07', W / 2 + 20, 24);
  g.textAlign = 'right'; g.fillText(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), W - 70, 24);
  // Akku
  g.strokeStyle = C.mute; g.lineWidth = 2; g.strokeRect(W - 58, 15, 38, 18); g.fillStyle = C.ok; g.fillRect(W - 55, 18, 26, 12); g.fillStyle = C.mute; g.fillRect(W - 19, 20, 4, 8);
  // WLAN
  g.strokeStyle = C.accent; g.lineWidth = 3;
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(W / 2 - 60, 32, 6 + i * 6, -Math.PI * 0.75, -Math.PI * 0.25); g.stroke(); }

  if (s.phase === 'off') { g.restore(); return; }
  const o = s.order;
  // Auftragskopf
  g.textAlign = 'left';
  g.fillStyle = C.text; g.font = `700 24px ${FONT}`;
  g.fillText(`Auftrag ${o.no}`, 18, 76);
  g.fillStyle = C.mute; g.font = `500 19px ${FONT}`;
  g.fillText(o.customer, 18, 104, W - 36);
  const total = s.posTotal ?? s.lines.length;
  const doneN = s.posDone ?? s.lines.filter(l => l.done).length;
  g.textAlign = 'right'; g.fillStyle = C.text; g.font = `700 22px ${MONO}`;
  g.fillText(`Pos. ${Math.min(doneN + 1, total)}/${total}`, W - 18, 76);
  // Fortschritt
  g.fillStyle = C.line; roundRect(g, 18, 122, W - 36, 10, 5); g.fill();
  g.fillStyle = C.ok; roundRect(g, 18, 122, Math.max(10, (W - 36) * doneN / Math.max(1, total)), 10, 5); g.fill();

  // Hauptkarte
  const cy = 148, ch = 470;
  g.fillStyle = C.card; roundRect(g, 14, cy, W - 28, ch, 18); g.fill();
  const ln = s.lines[s.idx];
  g.textAlign = 'left';
  const title = (t, col = C.accent) => { g.fillStyle = col; g.font = `800 24px ${FONT}`; g.fillText(t, 34, cy + 36); };
  if (s.phase === 'login') {
    title('ANMELDUNG');
    g.fillStyle = C.text; g.font = `600 30px ${FONT}`; g.fillText('Auftrag wird geladen …', 34, cy + 120);
    g.fillStyle = C.mute; g.font = `500 22px ${FONT}`; g.fillText(`${total} Positionen · Ziel ${o.dock}`, 34, cy + 170);
  } else if ((s.phase === 'goto' || s.phase === 'take' || s.phase === 'short' || s.phase === 'wait') && ln) {
    const scanned = s.phase !== 'goto' && s.phase !== 'wait';
    title(s.phase === 'goto' ? 'GEHE ZU · PLATZ SCANNEN' : s.phase === 'take' ? 'ENTNEHMEN' : s.phase === 'wait' ? 'NACHSCHUB LÄUFT' : 'FEHLMENGE?', s.phase === 'short' ? C.warn : C.accent);
    // Lagerplatz groß
    g.fillStyle = scanned ? C.ok : C.text;
    g.font = `800 92px ${MONO}`;
    g.fillText(ln.loc.code, 34, cy + 120);
    g.font = `700 22px ${FONT}`; g.fillStyle = C.mute;
    g.fillText(`Gang ${ln.loc.gang} · Platz ${ln.loc.platz} · Ebene ${ln.loc.level} (Boden)${scanned ? '  ✔ gescannt' : ''}`, 34, cy + 178, W - 70);
    // Artikel
    g.fillStyle = C.line; g.fillRect(34, cy + 200, W - 68, 2);
    g.fillStyle = C.text; g.font = `700 30px ${FONT}`;
    g.fillText(ln.a.name, 34, cy + 244, W - 70);
    g.fillStyle = C.mute; g.font = `500 22px ${FONT}`;
    g.fillText(`${ln.a.pack} · Art. ${ln.a.art} · MHD ${ln.loc.mhd}`, 34, cy + 280, W - 70);
    // Gewichtsklasse
    const clsCol = ln.a.cls === 'S' ? '#ef4444' : ln.a.cls === 'M' ? '#f59e0b' : '#22c55e';
    g.fillStyle = clsCol; roundRect(g, 34, cy + 302, 250, 40, 10); g.fill();
    g.fillStyle = '#0b1220'; g.font = `800 20px ${FONT}`;
    g.fillText(`${CLASS_TEXT[ln.a.cls]} · ${String(ln.a.kg).replace('.', ',')} kg`, 46, cy + 323);
    // Menge
    g.textAlign = 'right';
    g.fillStyle = ln.picked >= ln.qty ? C.ok : C.text;
    g.font = `800 84px ${MONO}`;
    g.fillText(`${ln.picked}/${ln.qty}`, W - 34, cy + 392);
    g.fillStyle = C.mute; g.font = `600 22px ${FONT}`; g.fillText('Kartons', W - 34, cy + 450);
    g.textAlign = 'left';
    g.fillStyle = C.text; g.font = `500 22px ${FONT}`;
    const hint = s.phase === 'goto' ? 'Scanne das Etikett mit ▼ am Regal.' : s.phase === 'take' ? 'Nimm die Kartons von der Palette.' : s.phase === 'wait' ? 'Stapler bringt Ware vom Reserveplatz.' : 'Platz leer – Fehlmenge melden.';
    g.fillText(hint, 34, cy + 404, W - 260);
    if (s.phase === 'short') {
      g.fillStyle = C.warn; roundRect(g, 34, cy + 424, 300, 32, 8); g.fill();
      g.fillStyle = '#1a1205'; g.font = `800 18px ${FONT}`; g.fillText(s.xr ? 'X = FEHLMENGE MELDEN' : 'LEERTASTE = FEHLMENGE', 46, cy + 441);
    }
  } else if (s.phase === 'deliver' || s.phase === 'wrap') {
    title(s.phase === 'wrap' ? 'PALETTE WIRD GESICHERT' : 'ZUM WARENAUSGANG');
    g.fillStyle = C.text; g.font = `800 92px ${MONO}`; g.fillText(o.dock, 34, cy + 120);
    g.fillStyle = C.mute; g.font = `600 24px ${FONT}`; g.fillText(o.dockText, 34, cy + 172, W - 70);
    g.fillStyle = C.text; g.font = `500 24px ${FONT}`;
    g.fillText(s.phase === 'wrap' ? 'Stretchfolie wird gewickelt …' : 'Hubwagen mitnehmen, WA-Etikett scannen.', 34, cy + 240, W - 70);
    g.fillStyle = C.mute; g.font = `500 22px ${FONT}`;
    g.fillText(`${s.cartons} Kartons · ${s.weight.toFixed(0)} kg auf der Palette`, 34, cy + 290);
  } else if (s.phase === 'done') {
    title('AUFTRAG FERTIG', C.ok);
    g.fillStyle = C.text; g.font = `800 60px ${FONT}`; g.fillText('✔ Gebucht', 34, cy + 120);
  }

  // Nächste Positionen
  const ny = cy + ch + 18;
  g.fillStyle = C.mute; g.font = `700 18px ${FONT}`; g.textAlign = 'left';
  g.fillText('NÄCHSTE POSITIONEN', 20, ny + 6);
  let k = 0;
  for (let i = s.idx + 1; i < s.lines.length && k < 2; i++) {
    const l = s.lines[i]; if (l.done) continue;
    const y = ny + 40 + k * 40;
    g.fillStyle = C.text; g.font = `600 22px ${MONO}`; g.fillText(l.loc.code, 20, y);
    g.font = `500 20px ${FONT}`; g.fillStyle = C.mute; g.fillText(`${l.qty} × ${l.a.name}`, 150, y, W - 170);
    k++;
  }
  if (!k) { g.fillStyle = C.mute; g.font = `500 20px ${FONT}`; g.fillText(s.phase === 'deliver' ? '– keine –' : `danach: ${o.dock}`, 20, ny + 40); }

  // Meldung (rot/grün) einblenden
  if (s.flash && s.flash.t > 0) {
    const col = s.flash.type === 'error' ? C.err : s.flash.type === 'ok' ? C.ok : C.warn;
    g.globalAlpha = Math.min(1, s.flash.t * 2);
    g.fillStyle = col; roundRect(g, 14, H - 150, W - 28, 76, 14); g.fill();
    g.fillStyle = '#0b1220'; g.font = `800 24px ${FONT}`; g.textAlign = 'center';
    g.fillText(s.flash.text, W / 2, H - 112, W - 50);
    g.globalAlpha = 1;
  }
  // Softkeys
  g.fillStyle = '#060a13'; g.fillRect(0, H - 60, W, 60);
  g.fillStyle = C.mute; g.font = `600 18px ${FONT}`; g.textAlign = 'center';
  g.fillText(s.xr ? 'Trigger: scannen/nehmen · X: Fehlmenge · Y: MDE' : 'Klick: scannen/nehmen · Leertaste: Fehlmenge · Tab: groß', W / 2, H - 30, W - 20);
  g.restore();
}
