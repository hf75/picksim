// PickSim – App-Steuerung: Lobby, Laden der Lagerwelten, Briefing, Pause, Auswertung, Wissens-Check, VR.
import * as THREE from 'three';
import { Engine, detectQuality, QUALITY } from './core/engine.js';
import { Input } from './core/input.js';
import { UI, rich } from './core/ui.js';
import { AudioFX } from './core/audio.js';
import { Assets } from './core/assets.js';
import { MaterialLib } from './core/materials.js';
import { Interaction } from './core/interaction.js';
import { Player } from './core/player.js';
import { Mission, loadResults, fmtTime, fmtNum } from './sim/mission.js';
import { LEVELS, levelById, nextLevel } from './levels/registry.js';
import { buildLobby } from './levels/lobby.js';

// ---------- Einstellungen ----------
const SKEY = 'picksim.settings.v1';
const settings = (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } })();
const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } };

const params = new URLSearchParams(location.search);
const engine = new Engine(document.getElementById('viewport'), params.get('q') || settings.quality || detectQuality());
const input = new Input(engine);
const ui = new UI(engine, input);
const audio = new AudioFX(engine);
const assets = new Assets(engine);
const mat = new MaterialLib(engine);
const interaction = new Interaction(engine, input, ui);
const player = new Player(engine, input);
audio.setEnabled(settings.sound !== false);
// VR-Tafeln weichen Regalen, Wänden und Gegenständen aus (Kollisionsboxen des Lagers)
ui.obstacles = () => ({ boxes: player.boxes, circles: player.circles });

window.PICKSIM = { engine, input, ui, audio, assets, mat, interaction, player, THREE };   // für Fehlersuche

/** Entwicklungshilfe: Simulation um n Sekunden weiterrechnen (auch wenn der Tab im Hintergrund ist) */
window.PICKSIM.pump = (seconds = 1, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) {
    engine.time += dt;
    for (const u of engine.updaters) { try { u.fn(dt, engine.time, null); } catch (e) { console.error(e); } }
  }
  engine.renderer.render(engine.scene, engine.camera);
  return engine.time;
};

/** Entwicklungshilfe: rendert ein Standbild in voller Auflösung und schickt es an den Dev-Server (--shots) */
window.PICKSIM.shot = async (name = 'shot.jpg', w = 1600, h = 900) => {
  const r = engine.renderer;
  const pr = r.getPixelRatio();
  r.setPixelRatio(1); r.setSize(w, h, false);
  engine.camera.aspect = w / h; engine.camera.updateProjectionMatrix();
  if (engine.composer) { engine.composer.setPixelRatio(1); engine.composer.setSize(w, h); engine.composer.render(0.016); }
  else r.render(engine.scene, engine.camera);
  const url = r.domElement.toDataURL('image/jpeg', 0.9);
  r.setPixelRatio(pr); engine.resize();
  const res = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
  return res.ok ? 'gespeichert: ' + name : 'Fehler ' + res.status;
};

engine.onUpdate(dt => {
  input.update();
  if (!ui.panelOpen) player.update(dt);
  interaction.enabled = !ui.panelOpen;
  if (!ui.panelOpen) interaction.update();
}, -10);
player.addEventListener('step', () => audio.play('step'));
// Ersatzsteuerung, wenn der Mausfang verweigert wird (z. B. in eingebetteten Seiten)
input.addEventListener('lockfallback', () => {
  ui.toast('Umsehen: **mit gedrückter Maustaste ziehen**. Kurz klicken = nehmen / ablegen.', 'info', 6500);
});

let current = null;       // { meta, level, ctx }
let xrSupported = false;
let busy = false;

// ---------- Kontext für Lagerwelten ----------
function makeContext(meta) {
  const root = new THREE.Group();
  root.name = 'level-' + meta.id;
  engine.scene.add(root);
  const unsubs = [], disposables = [];
  const ctx = {
    THREE, engine, input, ui, audio, assets, mat, player, interaction, root, meta, settings,
    get q() { return engine.q; },
    onUpdate(fn, order = 0) { const u = engine.onUpdate(fn, order); unsubs.push(u); return u; },
    track(o) { if (o) disposables.push(o); return o; },
    mission(opts) { const m = new Mission(ctx, { levelId: meta.id, title: meta.title, ...opts }); ctx.currentMission = m; return m; },
    complete(result, extra = {}) { showDebrief(result, extra); },
    showInfo(card) { return showInfoCard(card); },
    addInfoPoint(pos, card) { return addInfoPoint(ctx, pos, card); },
    currentMission: null,
    _unsubs: unsubs, _disposables: disposables,
  };
  return ctx;
}

function unloadCurrent() {
  if (!current) return;
  const { level, ctx } = current;
  try { level && level.dispose && level.dispose(); } catch (e) { console.error(e); }
  ctx._unsubs.forEach(u => u());
  const shared = sharedResources();
  ctx.root.traverse(o => {
    if (o.isLight && o.dispose) { o.dispose(); return; }   // gibt u. a. Schattenkarten frei
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (!m || shared.has(m)) continue;
        for (const k of TEX_KEYS) { const t = m[k]; if (t && t.isTexture && !shared.has(t)) t.dispose(); }
        m.dispose();
      }
    }
  });
  ctx._disposables.forEach(d => d && d.dispose && d.dispose());
  engine.scene.remove(ctx.root);
  engine.scene.environment = null;
  engine.scene.fog = null;
  engine.renderer.toneMappingExposure = 1.0;
  interaction.clear();
  player.clearColliders();
  player.detach();
  audio.stopAll();
  ui.device.show(false);
  ui.device.setCaption('');
  if (ui.device.big) ui.device.toggleBig();
  if (ui.device.canvas.width !== 600 || ui.device.canvas.height !== 900) ui.device.resize(600, 900);
  ui.setStats([]);
  ui.setObjective('');
  ui.setHand(null);
  ui.setTooltip(null);
  current = null;
}

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'displacementMap', 'clearcoatNormalMap', 'specularIntensityMap'];
function sharedResources() {
  const s = new Set();
  const addMat = m => { if (!m) return; s.add(m); if (m.isMaterial) for (const k of TEX_KEYS) if (m[k]) s.add(m[k]); };
  for (const t of assets.templates.values()) t.traverse(o => { if (o.isMesh) { s.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(addMat); } });
  for (const m of mat.matCache.values()) addMat(m);
  for (const e of mat.texCache.values()) if (e.tex) s.add(e.tex);
  return s;
}

// ---------- Infopunkte ----------
function addInfoPoint(ctx, pos, card) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(45,212,191,0.95)'; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#04201c'; g.font = '800 78px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('i', 64, 70);
  const tex = ctx.track(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.setScalar(0.26);
  sp.position.copy(pos);
  sp.userData.noEnvCapture = true;
  ctx.root.add(sp);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial());
  hit.visible = false; hit.position.copy(pos); ctx.root.add(hit);
  let seen = false;
  const t = interaction.add({
    object: sp, hit, kind: 'info', color: 0x2dd4bf, label: 'Info: ' + card.title, sub: 'Klicken zum Lesen', maxDist: 4, maxDistXR: 3,
    onPrimary: () => { seen = true; sp.material.opacity = 0.65; showInfoCard(card); },
  });
  const base = pos.y;
  ctx.onUpdate((dt, time) => { sp.position.y = base + Math.sin(time * 2 + pos.x) * 0.03; if (!seen) sp.scale.setScalar(0.26 + Math.sin(time * 4) * 0.015); });
  return t;
}

async function showInfoCard(card) {
  const m = current && current.ctx.currentMission;
  if (m) m.pause();
  audio.play('click');
  await ui.showPanel({ title: card.title, subtitle: card.subtitle, blocks: card.blocks, buttons: [{ label: 'Weiter', value: 'ok', primary: true }] });
  if (m) m.resume();
}

// ---------- VR ----------
async function enterVR() {
  if (!navigator.xr) return false;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] });
    await engine.renderer.xr.setSession(session);
    return true;
  } catch (e) {
    console.warn(e);
    ui.toast('VR konnte nicht gestartet werden: ' + (e.message || e), 'error', 5000);
    return false;
  }
}
function exitVR() { const s = engine.renderer.xr.getSession(); if (s) s.end(); }

// ---------- Lobby ----------
function levelArt(meta) {
  const [a, b, c] = meta.palette;
  const id = meta.id;
  let shapes = '';
  if (id === 'lager1') {
    for (let i = 0; i < 4; i++) shapes += `<rect x="${30 + i * 62}" y="40" width="46" height="90" fill="${b}" opacity=".9"/>` + [0, 1, 2, 3].map(k => `<rect x="${30 + i * 62}" y="${50 + k * 21}" width="46" height="3" fill="${c}"/><rect x="${36 + i * 62}" y="${38 + k * 21 + 4}" width="${12 + (k * 7 + i * 5) % 20}" height="9" fill="${['#3d6fb6', '#c0392b', '#e1b12c', '#2e8b57'][(i + k) % 4]}"/>`).join('');
    shapes += `<rect x="0" y="130" width="300" height="20" fill="#2a1d14"/><circle cx="250" cy="22" r="10" fill="#ffe9b0" opacity=".85"/>`;
  } else if (id === 'lager2') {
    for (let i = 0; i < 3; i++) { shapes += `<rect x="${24 + i * 90}" y="18" width="5" height="120" fill="${b}"/><rect x="${94 + i * 90}" y="18" width="5" height="120" fill="${b}"/>`; for (let k = 0; k < 3; k++) shapes += `<rect x="${24 + i * 90}" y="${50 + k * 38}" width="75" height="5" fill="${c}"/><rect x="${32 + i * 90}" y="${26 + k * 38}" width="58" height="24" fill="#c8a06e"/>`; }
    shapes += `<rect x="0" y="138" width="300" height="12" fill="#1b2430"/>`;
  } else if (id === 'lager3') {
    for (let i = 0; i < 5; i++) for (let k = 0; k < 4; k++) shapes += `<rect x="${22 + i * 54}" y="${24 + k * 28}" width="44" height="20" rx="3" fill="#1d3b3a"/><circle cx="${44 + i * 54}" cy="${48 + k * 28}" r="3" fill="${(i + k) % 3 === 0 ? '#34d399' : '#14524d'}"/>`;
    shapes += `<rect x="0" y="138" width="300" height="12" fill="#123"/>`;
  } else {
    for (let i = 0; i < 4; i++) shapes += `<rect x="${30 + i * 64}" y="${36 + (i % 2) * 18}" width="40" height="70" fill="#f2b705" opacity=".85"/><rect x="${26 + i * 64}" y="${106 + (i % 2) * 18}" width="48" height="10" rx="4" fill="#9aa3b5"/>`;
    shapes += `<g stroke="${c}" stroke-opacity=".35">${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 26}" y1="140" x2="${i * 26 - 30}" y2="150"/>`).join('')}</g>`;
  }
  return `<svg viewBox="0 0 300 150" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#05070a"/></linearGradient></defs><rect width="300" height="150" fill="url(#g${id})"/>${shapes}</svg>`;
}

async function showLobby() {
  input.gameActive = false;
  ui.showHUD(false);
  unloadCurrent();
  current = buildLobbyContext();
  const results = loadResults();
  const cards = LEVELS.map(l => {
    const r = results[l.id];
    const best = r && r.best ? `<div class="best">Bestes Ergebnis: ${'★'.repeat(r.best.stars)}${'☆'.repeat(3 - r.best.stars)} · ${fmtNum(r.best.linesPerHour)} Pos./h</div>` : '';
    return `<button class="level-card" data-value="level:${l.id}">
      <div class="art">${levelArt(l)}<span class="num">LAGER ${l.num}</span><span class="era">${l.era}</span></div>
      <div class="body"><h3>${l.title}</h3><div class="tag"><b style="color:#fff">${l.kind}.</b> ${l.tag}</div>${best}
      <div class="chips">${l.chips.map(([t, c]) => `<span class="chip ${c || ''}">${t}</span>`).join('')}<span class="chip">${l.duration}</span></div></div></button>`;
  }).join('');
  const qOpts = Object.values(QUALITY).map(q => `<option value="${q.key}" ${q.key === engine.qualityKey ? 'selected' : ''}>${q.label}</option>`).join('');
  const html = `<div class="lobby-wrap">
    <div class="brand"><div class="brand-logo"><svg width="30" height="30" viewBox="0 0 64 64"><path d="M10 50V22l22-12 22 12v28" fill="none" stroke="#f5a524" stroke-width="6" stroke-linejoin="round"/><rect x="22" y="32" width="20" height="18" fill="#f5a524"/></svg></div>
      <h1>Pick<span>Sim</span></h1></div>
    <p class="lobby-intro">Werde Kommissioniererin oder Kommissionierer in vier Lagern – vom kleinen Fachbodenlager mit Papierliste bis zum Robotik-Center, in dem die Regale zu dir kommen. Arbeite Aufträge ab, vermeide Pickfehler und vergleiche am Ende die Kennzahlen.</p>
    <div class="level-grid">${cards}</div>
    <div class="lobby-footer">
      <label>Grafik <select id="opt-quality">${qOpts}</select></label>
      <label><input type="checkbox" id="opt-sound" ${settings.sound !== false ? 'checked' : ''}> Ton</label>
      <span class="xr-status" id="xr-status">${xrSupported ? '<b>VR-Brille erkannt.</b> Lager wählen und im Briefing „In VR starten“.' : 'Für VR: Seite im Browser der Meta Quest 3 öffnen (HTTPS).'}</span>
      <button class="btn" data-value="help">Steuerung</button>
      <button class="btn" data-value="teacher">Für Lehrkräfte</button>
      <button class="credits-link" data-value="credits">Lizenzen & Quellen</button>
    </div></div>`;
  const xrButtons = LEVELS.map(l => ({ label: 'Lager ' + l.num, value: 'level:' + l.id, primary: l.id === 'lager1' }));
  const v = await ui.showPanel({
    cls: 'lobby',
    rawHTML: html,
    title: 'PickSim – Lager wählen',
    subtitle: 'Vier Lager, vier Arbeitsweisen. Starte mit Lager 01 und arbeite dich bis zum Robotik-Center vor.',
    xrBlocks: LEVELS.map(l => ({ p: `**Lager ${l.num} – ${l.title}:** ${l.kind}` })),
    buttons: [...xrButtons, ...(engine.isXR ? [{ label: 'VR beenden', value: 'exitvr' }] : [])],
    noRelock: true,
    onMount: el => {
      el.querySelector('#opt-quality').addEventListener('change', e => { settings.quality = e.target.value; saveSettings(); engine.setQuality(e.target.value); });
      el.querySelector('#opt-sound').addEventListener('change', e => { settings.sound = e.target.checked; saveSettings(); audio.setEnabled(e.target.checked); });
    },
  });
  if (!v) return;
  if (v === 'help') { await showHelp(); return showLobby(); }
  if (v === 'teacher') { await showTeacherInfo(); return showLobby(); }
  if (v === 'credits') { await showCredits(); return showLobby(); }
  if (v === 'exitvr') { exitVR(); return showLobby(); }
  if (v.startsWith('level:')) startLevel(v.slice(6));
}

function buildLobbyContext() {
  const meta = { id: 'lobby', title: 'Lobby' };
  const ctx = makeContext(meta);
  const level = buildLobby(ctx);
  player.setPose(0, 2.2, 0);
  return { meta, level, ctx };
}

async function showHelp() {
  await ui.showPanel({
    title: 'Steuerung',
    blocks: [
      { h: 'Am Computer' },
      { keys: [[['Maus', 'umsehen'], ['W+A+S+D', 'gehen (oder Pfeiltasten)'], ['Shift', 'schneller gehen'], ['Linksklick', 'nehmen / ablegen / scannen / drücken'], ['Rechtsklick', 'Ware zurücklegen / Rückgängig']],
        [['Tab', 'Liste bzw. Gerät groß / klein'], ['F', 'Wagen an- / abkoppeln'], ['Leertaste', 'bestätigen'], ['1 – 9', 'Position auf der Pickliste abhaken'], ['P', 'Pause-Menü · ESC gibt die Maus frei']]] },
      { h: 'Mit der Meta Quest 3' },
      { keys: [[['Linker Stick', 'gehen'], ['Rechter Stick', 'drehen (30°-Schritte)'], ['Trigger', 'nehmen / ablegen / scannen / drücken'], ['Grifftaste', 'greifen (wie Trigger)']],
        [['A', 'Ware zurücklegen / Rückgängig'], ['X', 'bestätigen'], ['Y', 'Liste / Gerät ein- und ausblenden'], ['B', 'Menü'], ['Linken Stick drücken', 'Wagen an- / abkoppeln']]] },
      { callout: 'Tipp für VR: Stell dich in einen freien Bereich von etwa 2 × 2 m. Wer empfindlich auf Bewegung reagiert, geht mit kurzen Stick-Impulsen oder läuft echte Schritte.', tone: 'teal' },
    ],
    buttons: [{ label: 'Alles klar', value: 'ok', primary: true }],
    noRelock: !(input.gameActive),
  });
}

async function showTeacherInfo() {
  const all = loadResults();
  const rows = LEVELS.map(l => {
    const r = all[l.id];
    return [`Lager ${l.num} · ${l.title}`, r ? String(r.runs) : '0', r && r.best ? `${fmtNum(r.best.linesPerHour)} Pos./h · ${r.best.errorCount} Fehler · ${'★'.repeat(r.best.stars)}` : '–'];
  });
  const v = await ui.showPanel({
    title: 'Für Lehrkräfte',
    subtitle: 'Lernpfad, Einsatzideen und Ergebnisse auf diesem Gerät',
    wide: true,
    blocks: [
      { h: 'Lernpfad' },
      { list: [
        '**Lager 01 – Fachbodenlager, Pick-by-Paper:** Lagerplatzadresse, Mann-zur-Ware, Wegzeit, Fehler ohne Scanner, Wegoptimierung.',
        '**Lager 02 – Palettenregallager, Pick-by-Scan:** Barcode & MDE, Echtzeitbuchung, chaotische Lagerung, Nachschub, Arbeitssicherheit.',
        '**Lager 03 – Fulfillment-Center, Pick-by-Light:** Multi-Order-Picking, Durchlaufregal (FIFO), Verpackung & Nachhaltigkeit.',
        '**Lager 04 – Robotik-Center, Ware-zur-Person:** AMR, Durchsatz, Ergonomie, Chancen und Risiken der Automatisierung.',
      ] },
      { h: 'Einsatz im Unterricht' },
      { list: [
        'Tandems: eine Person spielt (PC oder Quest), die andere protokolliert Wege, Fehler und Zeit – danach Wechsel.',
        'Jedes Lager dauert ca. 10–15 Minuten inkl. Briefing, Auswertung und Wissens-Check.',
        'Die Auswertung vergleicht die Lager automatisch (Positionen pro Stunde, Laufweg, Fehlerquote) – gute Grundlage für eine Diskussion zur Automatisierung im E-Commerce.',
        'Direktstart per Link: **?lager=lager2** · Grafikstufe erzwingen: **?q=low**',
      ] },
      { h: 'Ergebnisse auf diesem Gerät' },
      { table: { head: ['Lager', 'Durchgänge', 'Bestes Ergebnis'], rows } },
      { callout: 'Es werden keine Daten übertragen – Ergebnisse liegen nur im Browser dieses Geräts.', tone: 'teal' },
    ],
    buttons: [{ label: 'Ergebnisse löschen', value: 'reset' }, { label: 'Schließen', value: 'ok', primary: true }],
    noRelock: true,
  });
  if (v === 'reset') { try { localStorage.removeItem('picksim.results.v1'); } catch (e) { /* ignore */ } ui.toast('Ergebnisse gelöscht', 'ok'); }
}

async function showCredits() {
  let txt = '';
  try { const r = await fetch('assets/CREDITS.md'); if (r.ok) txt = await r.text(); } catch (e) { /* ignore */ }
  await ui.showPanel({
    title: 'Lizenzen & Quellen',
    blocks: [
      { p: '3D-Modelle: **NVIDIA SimReady** (Hugging Face, Lizenz **CC BY 4.0**) – für das Web konvertiert und vereinfacht. Texturen & HDRI: **Poly Haven / ambientCG** (CC0). Schriften: **Inter**, **JetBrains Mono** (SIL OFL). 3D-Engine: **three.js** (MIT).' },
      { html: txt ? `<div class="credits-list">${txt.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>` : '' },
    ],
    buttons: [{ label: 'Schließen', value: 'ok', primary: true }],
    noRelock: true,
  });
}

// ---------- Level starten ----------
async function startLevel(id) {
  if (busy) return;
  busy = true;
  const meta = levelById(id);
  ui.hidePanel();
  input.gameActive = false;
  ui.showHUD(false);
  ui.loading(true, `${meta.title} wird aufgebaut …`);
  unloadCurrent();
  const ctx = makeContext(meta);
  let level;
  try {
    const mod = await import(`./levels/${meta.file}`);
    ui.progress(0.15, 'Modelle laden …');
    level = await mod.default.build(ctx, { onProgress: (p, d) => ui.progress(0.15 + p * 0.7, d) });
    current = { meta, level, ctx };
    ui.progress(0.88, 'Texturen laden …');
    await mat.ready();
    ui.progress(0.95, 'Licht berechnen …');
    if (level.afterBuild) await level.afterBuild();
  } catch (e) {
    console.error(e);
    busy = false;
    ui.loading(false);
    current = { meta, level: null, ctx };
    await ui.showPanel({ title: 'Diese Lagerwelt ist noch im Aufbau', blocks: [{ p: 'Beim Laden ist ein Fehler aufgetreten oder das Lager ist noch nicht fertig.' }, { p: '`' + (e.message || e) + '`' }], buttons: [{ label: 'Zur Auswahl', value: 'back', primary: true }], noRelock: true });
    busy = false;
    return showLobby();
  }
  ui.loading(false);
  const sp = level.spawn || { x: 0, z: 0, yaw: 0 };
  player.setPose(sp.x, sp.z, sp.yaw || 0);
  ui.setLevel(`Lager ${meta.num} · ${meta.title}`);
  busy = false;
  showBriefing();
}

async function showBriefing() {
  const { meta, level } = current;
  const b = level.briefing || { blocks: [] };
  const buttons = [{ label: 'Zur Auswahl', value: 'back' }, { label: 'Steuerung', value: 'help' }];
  if (xrSupported && !engine.isXR) buttons.push({ label: 'In VR starten', value: 'vr', vr: true });
  buttons.push({ label: 'Los geht’s', value: 'start', primary: true });
  const v = await ui.showPanel({ title: b.title || meta.title, subtitle: b.subtitle || meta.kind, blocks: b.blocks, buttons, wide: true, noRelock: true });
  if (v === 'back') return showLobby();
  if (v === 'help') { await showHelp(); return showBriefing(); }
  if (v === 'vr') { const ok = await enterVR(); if (!ok) return showBriefing(); return beginMission(); }
  if (v === 'start') beginMission();
}

function beginMission() {
  input.gameActive = true;
  ui.showHUD(true);
  input.lock();
  if (current.level.start) current.level.start();
  ui.setHints(current.level.hints || [['WASD', 'gehen'], ['Klick', 'nehmen/ablegen'], ['Rechtsklick', 'zurücklegen'], ['P', 'Pause']]);
  watchPerformance();
}

// Automatische Grafikanpassung, falls der Rechner zu langsam ist (nicht in VR, nicht bei manueller Wahl)
let perfChecks = 0;
function watchPerformance() {
  if (settings.quality || params.get('q')) return;
  const check = () => {
    if (!input.gameActive || engine.isXR || ui.panelOpen || perfChecks > 3) return;
    const order = ['low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(engine.qualityKey);
    if (engine.fps < 38 && i > 0) {
      perfChecks++;
      engine.setQuality(order[i - 1]);
      ui.toast(`Grafik automatisch auf „${engine.quality.label}“ gesenkt (${Math.round(engine.fps)} FPS).`, 'info', 4000);
      setTimeout(check, 5000);
    }
  };
  setTimeout(check, 5000);
}

// ---------- Pause ----------
input.addEventListener('menu', () => { if (input.gameActive && !ui.panelOpen && current && current.level) showPause(); });
input.addEventListener('help', () => { if (input.gameActive && !ui.panelOpen) withPause(showHelp); });

async function withPause(fn) {
  const m = current && current.ctx.currentMission;
  if (m) m.pause();
  await fn();
  if (m) m.resume();
}

async function showPause() {
  const m = current.ctx.currentMission;
  if (m) m.pause();
  const buttons = [{ label: 'Zur Auswahl', value: 'lobby' }, { label: 'Neu starten', value: 'restart' }, { label: 'Steuerung', value: 'help' }];
  if (engine.isXR) buttons.push({ label: 'VR beenden', value: 'exitvr' });
  buttons.push({ label: 'Weiter', value: 'resume', primary: true });
  const v = await ui.showPanel({ title: 'Pause', subtitle: `Lager ${current.meta.num} · ${current.meta.title}`, blocks: current.level.pauseBlocks ? current.level.pauseBlocks() : [], buttons });
  if (v === 'help') { await showHelp(); return showPause(); }
  if (v === 'exitvr') { exitVR(); if (m) m.resume(); return; }
  if (v === 'restart') return startLevel(current.meta.id);
  if (v === 'lobby') return showLobby();
  if (m) m.resume();
}

// ---------- Auswertung ----------
async function showDebrief(res, extra = {}) {
  input.gameActive = false;
  input.unlock();
  ui.showHUD(false);
  audio.play('complete');
  const all = loadResults();
  const meta = current.meta;
  const bars = LEVELS.map(l => {
    const r = all[l.id] && all[l.id].last;
    return { label: 'Lager ' + l.num, value: r ? Math.round(r.linesPerHour) : 0, text: r ? fmtNum(r.linesPerHour) + ' Pos./h' : '–', me: l.id === meta.id };
  });
  const kpis = [
    { v: fmtTime(res.time), l: 'Zeit', h: `Richtzeit ${fmtTime(res.targetTime)}` },
    { v: fmtNum(res.linesPerHour), l: 'Positionen pro Stunde', h: 'Pickleistung' },
    { v: res.errorCount, l: 'Fehler', color: res.errorCount ? '#f87171' : '#34d399', h: `Fehlerquote ${fmtNum(res.errorRate * 100, 1)} %` },
    { v: fmtNum(res.distance) + ' m', l: 'Laufweg', h: `Wegzeitanteil ${fmtNum(res.walkShare * 100)} %` },
  ];
  const blocks = [{ stars: res.stars }, { kpis }, ...(extra.blocks || [])];
  blocks.push({ h: 'Vergleich der Lager (letzter Durchgang)' }, { bars });
  if (extra.lesson) blocks.push({ callout: extra.lesson, tone: 'teal' });
  const quiz = current.level.quiz || [];
  const buttons = [{ label: 'Ergebnis kopieren', value: 'copy' }];
  buttons.push(quiz.length ? { label: 'Weiter zum Wissens-Check', value: 'quiz', primary: true } : { label: 'Weiter', value: 'end', primary: true });
  const spec = { title: extra.title || 'Auftrag abgeschlossen', subtitle: `Lager ${meta.num} · ${meta.title}`, blocks, buttons, wide: true, noRelock: true, keepOpen: v => v === 'copy' && (copyResult(res), true) };
  if (engine.isXR) spec.buttons = spec.buttons.filter(b => b.value !== 'copy');
  const v = await ui.showPanel(spec);
  let quizScore = null;
  if (v === 'quiz') quizScore = await runQuiz(quiz);
  showEnd(res, quizScore, quiz.length);
}

function copyResult(res) {
  const name = settings.name ? settings.name + ' – ' : '';
  const txt = `${name}PickSim ${res.title}: ${res.lines} Positionen in ${fmtTime(res.time)} · ${fmtNum(res.linesPerHour)} Pos./h · Fehler: ${res.errorCount} · Laufweg ${fmtNum(res.distance)} m · ${'★'.repeat(res.stars)} (${new Date().toLocaleString('de-DE')})`;
  navigator.clipboard && navigator.clipboard.writeText(txt).then(() => ui.toast('Ergebnis in die Zwischenablage kopiert', 'ok'), () => {});
}

async function runQuiz(questions) {
  let right = 0;
  for (let i = 0; i < questions.length; i++) {
    // Antwortreihenfolge mischen (richtige Antwort nicht immer an derselben Stelle)
    const q0 = questions[i];
    const perm = q0.options.map((_, j) => j).sort(() => Math.random() - 0.5);
    const q = { ...q0, options: perm.map(j => q0.options[j]), correct: perm.indexOf(q0.correct) };
    const head = { title: `Wissens-Check · Frage ${i + 1} von ${questions.length}`, noRelock: true };
    const v = await ui.showPanel({ ...head, blocks: [{ progress: [i, questions.length] }, { p: '**' + q.q + '**' }, { options: q.options.map(t => ({ text: t })) }], buttons: [] });
    if (!v) return right;
    const k = Number(String(v).split(':')[1]);
    const ok = k === q.correct;
    if (ok) right++;
    audio.play(ok ? 'ok' : 'error');
    await ui.showPanel({
      ...head,
      blocks: [{ progress: [i + 1, questions.length] }, { p: '**' + q.q + '**' },
        { options: q.options.map((t, j) => ({ text: t, state: j === q.correct ? 'right' : (j === k ? 'wrong' : null) })), disabled: true },
        { callout: (ok ? '**Richtig!** ' : '**Nicht ganz.** ') + q.explain, tone: ok ? 'teal' : '' }],
      buttons: [{ label: i < questions.length - 1 ? 'Nächste Frage' : 'Abschluss', value: 'next', primary: true }],
    });
  }
  return right;
}

async function showEnd(res, quizScore, quizTotal) {
  const meta = current.meta;
  const nxt = nextLevel(meta.id);
  const blocks = [];
  if (quizScore != null) blocks.push({ kpis: [{ v: `${quizScore} / ${quizTotal}`, l: 'Wissens-Check richtig', color: quizScore === quizTotal ? '#34d399' : '#fbbf24' }, { v: '★'.repeat(res.stars) + '☆'.repeat(3 - res.stars), l: 'Bewertung des Auftrags' }] });
  if (current.level.summary) blocks.push(...current.level.summary(res));
  const buttons = [{ label: 'Zur Auswahl', value: 'lobby' }, { label: 'Nochmal spielen', value: 'again' }];
  if (nxt) buttons.push({ label: `Weiter: Lager ${nxt.num}`, value: 'next', primary: true });
  const v = await ui.showPanel({ title: 'Geschafft!', subtitle: `Lager ${meta.num} · ${meta.title}`, blocks, buttons, noRelock: true });
  if (v === 'again') return startLevel(meta.id);
  if (v === 'next' && nxt) return startLevel(nxt.id);
  return showLobby();
}

// ---------- Start ----------
async function boot() {
  ui.loading(true, 'PickSim wird geladen …');
  ui.progress(0.2, 'Schriften …');
  await Promise.race([
    Promise.all([document.fonts.load('600 16px Inter'), document.fonts.load('800 16px Inter'), document.fonts.load('500 16px "JetBrains Mono"')]),
    new Promise(r => setTimeout(r, 2500)),
  ]).catch(() => {});
  ui.progress(0.5, 'Modellkatalog …');
  await assets.loadManifest();
  if (navigator.xr && navigator.xr.isSessionSupported) {
    try { xrSupported = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { xrSupported = false; }
  }
  ui.progress(1, '');
  ui.loading(false);
  const direct = params.get('lager');
  if (direct && levelById(direct)) { current = buildLobbyContext(); startLevel(direct); }
  else showLobby();
}

engine.addEventListener('xrstart', () => { ui.toast('Willkommen in VR! Linker Stick: gehen · Trigger: nehmen · B: Menü', 'info', 5000); });
engine.addEventListener('xrend', () => { if (input.gameActive) ui.toast('VR beendet – klicke ins Bild, um am Bildschirm weiterzuspielen.', 'info', 4000); });
boot();
