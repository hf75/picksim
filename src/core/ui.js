// Benutzeroberfläche: Desktop-HUD (HTML) und VR-Panels (Canvas-Texturen im Raum).
// Panels werden aus "Blöcken" beschrieben und für beide Welten gerendert.
import * as THREE from 'three';
import { roundRect } from './interaction.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** **fett** → <b> */
export const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

export class UI extends THREE.EventDispatcher {
  constructor(engine, input) {
    super();
    this.engine = engine;
    this.input = input;
    this.hud = $('hud');
    this.overlay = $('overlay');
    this.tooltipEl = $('tooltip');
    this.crosshair = $('crosshair');
    this.toastsEl = $('toasts');
    this.statsEl = $('hud-stats');
    this.levelEl = $('hud-level');
    this.objectiveEl = $('hud-objective');
    this.hintEl = $('hint-bar');
    this.handEl = $('hand-badge');
    this.clickToPlay = $('click-to-play');
    this.panelOpen = false;
    this._resolve = null;
    this._tooltipKey = '';

    // Gerät (Pickliste / MDE / Display) – ein Canvas für Desktop-Dock und VR
    const dc = $('device-canvas');
    dc.width = 600; dc.height = 900;
    this.device = {
      canvas: dc,
      ctx: dc.getContext('2d'),
      texture: new THREE.CanvasTexture(dc),
      dock: $('device-dock'),
      caption: $('device-caption'),
      visible: false,
      big: false,
      update: () => { this.device.texture.needsUpdate = true; },
      show: v => { this.device.visible = v; this.device.dock.hidden = !v || this.engine.isXR; },
      setCaption: t => { this.device.caption.innerHTML = t || ''; },
      toggleBig: () => { this.device.big = !this.device.big; this.device.dock.classList.toggle('big', this.device.big); },
      resize: (w, h) => { dc.width = w; dc.height = h; this.device.texture.dispose(); this.device.texture = new THREE.CanvasTexture(dc); this.device.texture.colorSpace = THREE.SRGBColorSpace; this.device.texture.anisotropy = 4; },
    };
    this.device.texture.colorSpace = THREE.SRGBColorSpace;
    this.device.texture.anisotropy = 4;

    // VR-Elemente
    this.xrPanel = new XRPanel(engine, input, this);
    this._xrToast = makeHeadToast(engine);

    input.addEventListener('lockchange', e => this._updateClickToPlay());
    engine.addEventListener('xrstart', () => { this.device.dock.hidden = true; this._updateClickToPlay(); if (this.panelOpen && this._spec) this.xrPanel.show(this._spec, this._onButton); });
    engine.addEventListener('xrend', () => { this.device.dock.hidden = !this.device.visible; this.xrPanel.hide(); if (this.panelOpen && this._spec) this._renderHTMLPanel(this._spec); });
    engine.onUpdate(dt => { this.xrPanel.update(dt); this._xrToast.update(dt); }, 50);
  }

  _updateClickToPlay() {
    const show = this.input.gameActive && !this.input.lookActive && !this.panelOpen && !this.engine.isXR;
    this.clickToPlay.hidden = !show;
  }

  showHUD(v) { this.hud.hidden = !v; }
  setLevel(text) { this.levelEl.textContent = text || ''; }
  setObjective(text) { this.objectiveEl.innerHTML = rich(text || ''); this.objective = text; this.dispatchEvent({ type: 'objective', text }); }
  setHints(list) { this.hintEl.innerHTML = (list || []).map(([k, t]) => `<span><kbd>${esc(k)}</kbd> ${esc(t)}</span>`).join(''); }
  setStats(list) {
    const html = (list || []).map(s => `<div class="stat ${s.cls || ''}"><div class="v">${esc(s.value)}</div><div class="l">${esc(s.label)}</div></div>`).join('');
    if (html !== this._statsHTML) { this._statsHTML = html; this.statsEl.innerHTML = html; }
    this.stats = list;
  }
  setHand(html) { this.handEl.hidden = !html; this.handEl.innerHTML = html || ''; }

  setTooltip(label, sub, ok = false) {
    const key = label ? label + '|' + (sub || '') + ok : '';
    if (key === this._tooltipKey) return;
    this._tooltipKey = key;
    if (!label) { this.tooltipEl.hidden = true; this.crosshair.classList.remove('active', 'ok'); return; }
    this.tooltipEl.hidden = false;
    this.tooltipEl.innerHTML = esc(label) + (sub ? `<small>${esc(sub)}</small>` : '');
    this.crosshair.classList.add('active');
    this.crosshair.classList.toggle('ok', !!ok);
  }

  toast(text, type = 'info', ms = 3200) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = rich(text);
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380); }, ms);
    this._xrToast.show(text, type, ms);
  }

  loading(v, title = 'Lager wird aufgebaut …') {
    $('loading').hidden = !v;
    $('loading-title').textContent = title;
    if (v) this.progress(0, '');
    // in VR ist das HTML-Overlay unsichtbar → Hinweis im Sichtfeld
    if (this.engine.isXR) { if (v) this._xrToast.show(title, 'info', 120000); else this._xrToast.show('Fertig!', 'ok', 600); }
  }
  progress(p, detail) {
    $('loading-bar').style.width = Math.round(p * 100) + '%';
    if (detail != null) $('loading-detail').textContent = detail;
  }

  /**
   * Panel anzeigen. spec = { title, subtitle, blocks:[...], html, buttons:[{label,value,primary,vr}], cls, wide, onMount(el) }
   * Gibt ein Promise mit dem Wert des gedrückten Buttons zurück.
   */
  showPanel(spec) {
    if (this._resolve) { const r = this._resolve; this._resolve = null; r(null); }
    this.panelOpen = true;
    this._spec = spec;
    this.input.unlock();
    this._updateClickToPlay();
    return new Promise(resolve => {
      this._resolve = resolve;
      this._onButton = (value, viaMouse) => {
        if (spec.keepOpen && spec.keepOpen(value)) return;
        this.hidePanel();
        if (viaMouse && this.input.gameActive && !spec.noRelock) this.input.lock();
        resolve(value);
      };
      if (this.engine.isXR) this.xrPanel.show(spec, this._onButton);
      else this._renderHTMLPanel(spec);
      this.dispatchEvent({ type: 'panel', open: true });
    });
  }

  /** Panel-Inhalt aktualisieren ohne das Promise zu beenden */
  updatePanel(spec) {
    this._spec = spec;
    if (this.engine.isXR) this.xrPanel.show(spec, this._onButton);
    else this._renderHTMLPanel(spec);
  }

  hidePanel() {
    this.panelOpen = false;
    this._spec = null;
    this.overlay.hidden = true;
    this.overlay.className = '';
    this.overlay.innerHTML = '';
    this.xrPanel.hide();
    this._updateClickToPlay();
    this.dispatchEvent({ type: 'panel', open: false });
  }

  _renderHTMLPanel(spec) {
    const o = this.overlay;
    o.hidden = false;
    o.className = spec.cls || '';
    if (spec.rawHTML) {
      o.innerHTML = spec.rawHTML;
    } else {
      const btns = (spec.buttons || []).map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.vr ? 'vr' : ''}" data-i="${i}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}</button>`).join('');
      o.innerHTML = `<div class="panel" style="${spec.wide ? 'width:min(1100px,100%)' : ''}">
        ${spec.title ? `<h1>${esc(spec.title)}</h1>` : ''}
        ${spec.subtitle ? `<p class="subtitle">${rich(spec.subtitle)}</p>` : ''}
        ${blocksToHTML(spec.blocks || [])}
        ${spec.html || ''}
        ${btns ? `<div class="panel-actions">${btns}</div>` : ''}
      </div>`;
    }
    o.querySelectorAll('[data-i]').forEach(el => el.addEventListener('click', () => {
      const b = spec.buttons[Number(el.dataset.i)];
      if (b && !b.disabled) this._onButton(b.value, true);
    }));
    o.querySelectorAll('[data-value]').forEach(el => el.addEventListener('click', () => this._onButton(el.dataset.value, true)));
    if (spec.onMount) spec.onMount(o, v => this._onButton(v, true));
    o.scrollTop = 0;
  }
}

// ---------- Blöcke → HTML ----------
export function blocksToHTML(blocks) {
  return blocks.map(b => {
    if (b.h) return `<h2>${esc(b.h)}</h2>`;
    if (b.p) return `<p>${rich(b.p)}</p>`;
    if (b.list) return `<ul>${b.list.map(li => `<li>${rich(li)}</li>`).join('')}</ul>`;
    if (b.callout) return `<div class="callout ${b.tone || ''}">${rich(b.callout)}</div>`;
    if (b.kpis) return `<div class="kpis">${b.kpis.map(k => `<div class="kpi"><div class="v" style="${k.color ? 'color:' + k.color : ''}">${esc(k.v)}</div><div class="l">${esc(k.l)}</div>${k.h ? `<div class="h">${rich(k.h)}</div>` : ''}</div>`).join('')}</div>`;
    if (b.stars != null) return `<div class="stars">${[0, 1, 2].map(i => i < b.stars ? '★' : '<span class="off">★</span>').join('')}</div>`;
    if (b.table) return `<table class="check"><thead><tr>${b.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.table.rows.map(r => `<tr>${r.map(c => typeof c === 'object' && c ? `<td class="${c.cls || ''}">${rich(c.t)}</td>` : `<td>${rich(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (b.bars) { const max = Math.max(1, ...b.bars.map(x => x.value)); return `<div class="compare-bars">${b.bars.map(x => `<div class="compare-row ${x.me ? 'me' : ''}"><div>${esc(x.label)}</div><div class="bar"><span style="width:${Math.max(2, x.value / max * 100)}%"></span></div><div style="text-align:right;font-family:var(--mono)">${esc(x.text ?? x.value)}</div></div>`).join('')}</div>`; }
    if (b.keys) return `<div class="grid2">${b.keys.map(col => `<ul style="list-style:none;padding:0">${col.map(([k, t]) => `<li style="margin:7px 0">${k.split('+').map(x => `<kbd>${esc(x)}</kbd>`).join(' + ')} &nbsp;${rich(t)}</li>`).join('')}</ul>`).join('')}</div>`;
    if (b.options) return `<div class="quiz-options">${b.options.map((o, i) => b.disabled
      ? `<div class="quiz-opt ${o.state || ''}">${rich(o.text)}</div>`
      : `<button class="quiz-opt" data-value="${esc(o.value ?? 'opt:' + i)}">${rich(o.text)}</button>`).join('')}</div>`;
    if (b.progress) return `<div class="progress-dots">${Array.from({ length: b.progress[1] }, (_, i) => `<i class="${i < b.progress[0] ? 'done' : ''}"></i>`).join('')}</div>`;
    if (b.html) return b.html;
    return '';
  }).join('');
}

// ---------- VR-Panel ----------
const PW = 1600, PH = 1040;   // Canvas-Pixel
const PM = 1.5;               // Breite in Metern
const PANEL_H = PM * PH / PW; // Höhe in Metern
const PANEL_DIST = 1.35;      // Wunschabstand vor dem Kopf
// niedrige Kollisionsobjekte (Tische, Förderbänder, Geländer …): über ihnen darf eine Tafel schweben –
// sie werden nur über die 3D-Strahlen geprüft, nicht über die (höhenlosen) Kollisionsboxen
const LOW_COLLIDER_TAGS = new Set(['desk', 'packing', 'packtable', 'rail', 'pallets', 'conv', 'conveyor', 'outconv', 'cart']);

/** nächster Treffer eines 2D-Strahls (Richtung normiert) mit Kollisionsboxen/-kreisen; Infinity wenn frei */
function rayVsColliders(ox, oz, dx, dz, boxes = [], circles = []) {
  let best = Infinity;
  for (const b of boxes) {
    if (ox > b.minX && ox < b.maxX && oz > b.minZ && oz < b.maxZ) continue;   // man steht (fast) drin → ignorieren
    let tmin = -Infinity, tmax = Infinity;
    if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) continue; }
    else { let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
    if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) continue; }
    else { let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
    if (tmax >= tmin && tmax > 0) best = Math.min(best, Math.max(tmin, 0));
  }
  for (const c of circles) {
    const fx = ox - c.x, fz = oz - c.z;
    const b = fx * dx + fz * dz, cc = fx * fx + fz * fz - c.r * c.r;
    if (cc < 0) continue;
    const disc = b * b - cc;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0) best = Math.min(best, t);
  }
  return best;
}

class XRPanel {
  constructor(engine, input, ui) {
    this.engine = engine; this.input = input; this.ui = ui;
    this.canvas = document.createElement('canvas');
    this.canvas.width = PW; this.canvas.height = PH;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const h = PM * PH / PW;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PM, h), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: true, toneMapped: false }));
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.mesh.name = 'xr-panel';
    engine.scene.add(this.mesh);
    this.buttons = [];
    this.hover = -1;
    this.spec = null;
    this.raycaster = new THREE.Raycaster();
    input.addEventListener('primary', e => this._click(e));
    input.addEventListener('grab', e => this._click(e));
  }

  show(spec, onButton) {
    this.spec = spec; this.onButton = onButton;
    this.hover = -1;
    this.draw();
    if (!this.mesh.visible && !this._reuseLastPlace()) this._place();
    this.mesh.visible = true;
  }
  hide() {
    if (this.mesh.visible) this._hiddenAt = performance.now();
    this.mesh.visible = false; this.spec = null;
  }

  /**
   * Tafel an einer freien Stelle aufstellen – nie in Regalen, Wänden oder Gegenständen.
   * Prüft mit Sichtstrahlen (Kopf → Tafelfläche, drei Höhen) gegen die Szene und die Kollisionsboxen.
   * Ist geradeaus kein Platz, dreht sich die Tafel schrittweise zur Seite; ist nirgends genug Platz,
   * rückt sie näher heran und wird so verkleinert, dass sie gleich groß wirkt.
   */
  _place() {
    const cam = this.engine.camera;
    const head = new THREE.Vector3(); cam.getWorldPosition(head);
    const yaw0 = this.engine.headYaw();
    const D = PANEL_DIST, DMIN = 0.45, MARGIN = 0.12;
    const alpha = Math.atan((PM / 2) / D);                 // Winkel zur Tafelkante (bleibt beim Skalieren gleich)
    const yC = Math.max(1.15, head.y - 0.12);
    const meshes = this._obstacleMeshes();
    // Kandidaten nur im Blickfeld (±70°). Bewertung: voller Abstand gut, seitliches Wegdrehen kostet –
    // so rückt die Tafel vor einem Regal lieber näher (und wird kleiner), statt aus dem Sichtfeld zu wandern.
    const far = D + MARGIN + 0.2;
    let best = null;
    for (const deg of [0, 10, -10, 20, -20, 30, -30, 45, -45, 60, -60, 70, -70]) {
      const pen = Math.pow(Math.abs(deg) / 35, 2) * 0.35;
      if (best && best.score >= 1 - pen) break;                       // weiter seitlich kann es nicht besser werden
      const yaw = yaw0 + deg * Math.PI / 180;
      let d = Math.min(D, this._freeDistance(head, yC, yaw, alpha, null, far) - MARGIN);   // schnell: nur Kollisionsboxen
      if (d < DMIN || (best && d / D - pen <= best.score)) continue;
      d = Math.min(D, this._freeDistance(head, yC, yaw, alpha, meshes, far) - MARGIN);     // genau: 3D-Sichtstrahlen
      if (d < DMIN) continue;
      const score = d / D - pen;
      if (!best || score > best.score) best = { yaw, d, score };
    }
    const pick = best || { yaw: yaw0, d: DMIN, overlay: true };
    const d = pick.d;
    const s = d / D;                                        // gleiche scheinbare Größe
    this.mesh.scale.setScalar(s);
    this.mesh.position.set(head.x - Math.sin(pick.yaw) * d, yC, head.z - Math.cos(pick.yaw) * d);
    this.mesh.rotation.set(0, pick.yaw, 0);
    // nur im Notfall (extrem eng, z. B. Nase an der Wand) über alles zeichnen, damit die Tafel lesbar bleibt
    this.mesh.material.depthTest = !pick.overlay;
    this._last = { head: head.clone(), yaw: yaw0 };
  }

  /** gleiche Position wie die vorige Tafel, wenn direkt hintereinander (z. B. Quizfragen) und kaum bewegt */
  _reuseLastPlace() {
    if (!this._last || !this._hiddenAt || performance.now() - this._hiddenAt > 1500) return false;
    const head = new THREE.Vector3(); this.engine.camera.getWorldPosition(head);
    let dy = this.engine.headYaw() - this._last.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return head.distanceTo(this._last.head) < 0.35 && Math.abs(dy) < 0.5;
  }

  /** feste Objekte im Umkreis von ~3 m, an denen sich die Tafel stoßen kann */
  _obstacleMeshes() {
    const list = [];
    const rig = this.engine.rig;
    const head = new THREE.Vector3(); this.engine.camera.getWorldPosition(head);
    const sphere = new THREE.Sphere();
    const reach = PANEL_DIST + 1.0;
    this.engine.scene.traverse(o => {
      if (!o.isMesh || o === this.mesh || o.userData.noEnvCapture) return;
      let p = o.parent;
      while (p) { if (p === rig || p.userData.noEnvCapture) return; p = p.parent; }
      const g = o.geometry;
      if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); sphere.copy(o.boundingSphere); }
      else { if (!g.boundingSphere) g.computeBoundingSphere(); sphere.copy(g.boundingSphere); }
      sphere.applyMatrix4(o.matrixWorld);
      if (sphere.distanceToPoint(head) > reach) return;
      list.push(o);
    });
    return list;
  }

  /** größter Abstand in Richtung yaw, bei dem die Tafel (Breite ±alpha) frei steht */
  _freeDistance(head, yC, yaw, alpha, meshes, far) {
    let free = far;
    const rc = this.raycaster;
    const obs = this.ui.obstacles ? this.ui.obstacles() : null;
    const tall = obs ? obs.boxes.filter(b => !LOW_COLLIDER_TAGS.has(b.tag)) : null;
    const o = new THREE.Vector3(), dir = new THREE.Vector3();
    for (const t of [-1, -0.5, 0, 0.5, 1]) {
      const a = yaw + t * alpha, ca = Math.cos(t * alpha);
      dir.set(-Math.sin(a), 0, -Math.cos(a));
      let hit = far / ca;
      // 2D-Kollisionsboxen hoher Objekte (Regale, Wände, Säulen, Zäune …) – lückenlos, auch wo Regale offen sind
      if (tall) hit = Math.min(hit, rayVsColliders(head.x, head.z, dir.x, dir.z, tall, []));
      // 3D-Strahlen in drei Höhen (Unterkante, Mitte, Oberkante der Tafel) – erkennen auch Tische, Geräte, Paletten
      if (meshes) for (const h of [yC - PANEL_H * 0.42, yC, yC + PANEL_H * 0.4]) {
        o.set(head.x, h, head.z);
        rc.set(o, dir);
        rc.near = 0.05; rc.far = hit;
        const hits = rc.intersectObjects(meshes, false);
        if (hits.length) hit = Math.min(hit, hits[0].distance);
      }
      free = Math.min(free, hit * ca);
    }
    return free;
  }

  _hitButton(ctrl) {
    if (!this.mesh.visible) return { i: -1 };
    const m = new THREE.Matrix4().extractRotation(ctrl.ray.matrixWorld);
    const o = new THREE.Vector3().setFromMatrixPosition(ctrl.ray.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(m);
    this.raycaster.set(o, dir);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) return { i: -1 };
    const x = hit.uv.x * PW, y = (1 - hit.uv.y) * PH;
    const i = this.buttons.findIndex(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return { i, hit };
  }

  update() {
    if (!this.mesh.visible || !this.engine.isXR) return;
    let hov = -1;
    for (const c of this.input.controllers) {
      if (!c.source) continue;
      const { i, hit } = this._hitButton(c);
      if (hit) { c.line.scale.z = hit.distance; c.dot.visible = true; c.dot.position.set(0, 0, -hit.distance); c.line.material.color.set(i >= 0 ? 0xf5a524 : 0xffffff); }
      if (i >= 0) hov = i;
    }
    if (hov !== this.hover) { this.hover = hov; this.draw(); }
  }

  _click(e) {
    if (!this.mesh.visible || e.source !== 'xr') return;
    const { i } = this._hitButton(e.controller);
    if (i >= 0) {
      const b = this.buttons[i];
      if (b.disabled) return;
      this.input.pulse(e.controller, 0.5, 40);
      if (b.value !== undefined && this.onButton) this.onButton(b.value, false);
    }
  }

  draw() {
    const g = this.g, spec = this.spec;
    if (!spec) return;
    g.clearRect(0, 0, PW, PH);
    g.fillStyle = 'rgb(14,19,26)';   // voll deckend – nur die runden Ecken sind transparent
    roundRect(g, 4, 4, PW - 8, PH - 8, 46); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 4; g.stroke();
    const pad = 70;
    let scale = 1;
    // Layout mit Schrumpfen bei Überlauf
    for (let attempt = 0; attempt < 6; attempt++) {
      const h = this._layout(scale, true);
      if (h <= PH - 210) break;
      scale *= 0.88;
    }
    this.buttons = [];
    this._layout(scale, false);       // registriert ggf. Antwort-Zeilen als Buttons
    // Buttons (rechtsbündig)
    const btns = (spec.buttons || []);
    const by = PH - 150, bh = 92;
    g.font = `700 40px Inter, system-ui, sans-serif`;
    const rects = [];
    let bx = PW - pad;
    for (let i = btns.length - 1; i >= 0; i--) {
      const w = Math.max(220, g.measureText(btns[i].label).width + 70);
      bx -= w;
      rects[i] = { x: bx, w };
      bx -= 22;
    }
    btns.forEach((b, i) => {
      const idx = this.buttons.length;
      const { x, w } = rects[i];
      const hov = this.hover === idx;
      g.fillStyle = b.disabled ? 'rgba(255,255,255,0.05)' : b.primary ? (hov ? '#ffc04f' : '#f5a524') : b.vr ? (hov ? '#5eead4' : '#2dd4bf') : (hov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.09)');
      roundRect(g, x, by, w, bh, 22); g.fill();
      if (hov && !b.primary) { g.strokeStyle = '#f5a524'; g.lineWidth = 4; g.stroke(); }
      g.fillStyle = b.primary || b.vr ? '#1a1205' : (b.disabled ? '#667' : '#fff');
      g.font = `700 40px Inter, system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(b.label, x + w / 2, by + bh / 2 + 2);
      this.buttons.push({ x, y: by, w, h: bh, value: b.value, disabled: b.disabled });
    });
    this.tex.needsUpdate = true;
  }

  /** zeichnet Titel und Blöcke; gibt Höhe zurück */
  _layout(s, measureOnly) {
    const g = this.g, spec = this.spec;
    const pad = 70, W = PW - pad * 2;
    let y = 64;
    const T = (txt, size, weight, color, maxW = W, lh = 1.38) => {
      y = drawRich(g, txt, pad, y, maxW, size * s, weight, color, lh, measureOnly);
    };
    g.textAlign = 'left'; g.textBaseline = 'top';
    if (spec.title) { T(spec.title, 64, 800, '#ffffff'); y += 6 * s; }
    if (spec.subtitle) { T(spec.subtitle, 34, 400, '#9aa7b6'); y += 10 * s; }
    for (const b of (spec.xrBlocks || spec.blocks || [])) {
      if (b.h) { y += 18 * s; T(b.h, 38, 700, '#f5a524'); y += 4 * s; }
      else if (b.p) { T(b.p, 33, 400, '#d5dde6'); y += 10 * s; }
      else if (b.callout) {
        const y0 = y; y += 16 * s;
        const save = y;
        y = drawRich(g, b.callout, pad + 30, y, W - 50, 32 * s, 400, '#e9eef4', 1.38, true);
        const hgt = y - save + 32 * s;
        if (!measureOnly) {
          g.fillStyle = b.tone === 'teal' ? 'rgba(45,212,191,0.10)' : 'rgba(245,165,36,0.10)';
          roundRect(g, pad, y0, W, hgt, 16); g.fill();
          g.fillStyle = b.tone === 'teal' ? '#2dd4bf' : '#f5a524'; g.fillRect(pad, y0, 7, hgt);
          drawRich(g, b.callout, pad + 30, save, W - 50, 32 * s, 400, '#e9eef4', 1.38, false);
        }
        y = y0 + hgt + 16 * s;
      }
      else if (b.list) { for (const li of b.list) { if (!measureOnly) { g.fillStyle = '#f5a524'; g.beginPath(); g.arc(pad + 12, y + 20 * s, 7 * s, 0, 7); g.fill(); } y = drawRich(g, li, pad + 36, y, W - 36, 32 * s, 400, '#d5dde6', 1.36, measureOnly); y += 6 * s; } y += 6 * s; }
      else if (b.kpis) {
        const n = b.kpis.length, cols = Math.min(n, 4), gap = 20, cw = (W - gap * (cols - 1)) / cols, ch = 150 * s;
        b.kpis.forEach((k, i) => {
          const cx = pad + (i % cols) * (cw + gap), cy = y + Math.floor(i / cols) * (ch + gap);
          if (measureOnly) return;
          g.fillStyle = 'rgba(255,255,255,0.05)'; roundRect(g, cx, cy, cw, ch, 18); g.fill();
          g.fillStyle = k.color || '#fff'; g.font = `800 ${58 * s}px Inter, system-ui, sans-serif`; g.fillText(String(k.v), cx + 24, cy + 20 * s, cw - 40);
          g.fillStyle = '#9aa7b6'; g.font = `500 ${28 * s}px Inter, system-ui, sans-serif`; g.fillText(String(k.l), cx + 24, cy + 92 * s, cw - 40);
        });
        y += Math.ceil(n / cols) * (ch + gap) + 6 * s;
      }
      else if (b.stars != null) { if (!measureOnly) { g.font = `${70 * s}px Inter, sans-serif`; for (let i = 0; i < 3; i++) { g.fillStyle = i < b.stars ? '#f5a524' : 'rgba(255,255,255,0.15)'; g.fillText('★', pad + i * 80 * s, y); } } y += 90 * s; }
      else if (b.table) {
        const cols = b.table.head.length; const cw = W / cols; const rh = 50 * s;
        if (!measureOnly) {
          g.font = `600 ${26 * s}px Inter, sans-serif`; g.fillStyle = '#9aa7b6';
          b.table.head.forEach((h, i) => g.fillText(h.toUpperCase(), pad + i * cw, y, cw - 10));
        }
        y += rh;
        for (const r of b.table.rows) {
          if (!measureOnly) {
            r.forEach((c, i) => {
              const t = typeof c === 'object' && c ? c.t : c; const cls = typeof c === 'object' && c ? c.cls : '';
              g.fillStyle = cls === 'st-ok' ? '#34d399' : cls === 'st-err' ? '#f87171' : cls === 'st-warn' ? '#fbbf24' : '#e9eef4';
              g.font = `${cls ? 700 : 400} ${28 * s}px Inter, sans-serif`;
              g.fillText(String(t).replace(/\*\*/g, ''), pad + i * cw, y, cw - 12);
            });
            g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(pad, y + rh - 10 * s, W, 2);
          }
          y += rh;
        }
        y += 10 * s;
      }
      else if (b.bars) {
        const max = Math.max(1, ...b.bars.map(x => x.value));
        for (const x of b.bars) {
          if (!measureOnly) {
            g.font = `500 ${28 * s}px Inter, sans-serif`; g.fillStyle = '#e9eef4'; g.fillText(x.label, pad, y, 360);
            g.fillStyle = 'rgba(255,255,255,0.07)'; roundRect(g, pad + 380, y + 6 * s, W - 380 - 200, 26 * s, 13 * s); g.fill();
            g.fillStyle = x.me ? '#2dd4bf' : '#f5a524'; roundRect(g, pad + 380, y + 6 * s, Math.max(10, (W - 580) * x.value / max), 26 * s, 13 * s); g.fill();
            g.fillStyle = '#e9eef4'; g.textAlign = 'right'; g.fillText(String(x.text ?? x.value), pad + W, y, 190); g.textAlign = 'left';
          }
          y += 48 * s;
        }
        y += 8 * s;
      }
      else if (b.keys) {
        for (const col of b.keys) for (const [k, t] of col) { y = drawRich(g, `**${k}** – ${t}`, pad, y, W, 30 * s, 400, '#d5dde6', 1.35, measureOnly); y += 4 * s; }
      }
      else if (b.progress) {
        if (!measureOnly) for (let i = 0; i < b.progress[1]; i++) { g.fillStyle = i < b.progress[0] ? '#f5a524' : 'rgba(255,255,255,0.14)'; roundRect(g, pad + i * 56, y, 46, 10, 5); g.fill(); }
        y += 30 * s;
      }
      else if (b.options) {
        b.options.forEach((o, i) => {
          const y0 = y;
          const hEst = drawRich(g, o.text, pad + 34, y + 22 * s, W - 68, 32 * s, 500, '#e9eef4', 1.3, true) - y + 22 * s;
          if (!measureOnly) {
            const idx = this.buttons.length;
            const hov = !b.disabled && this.hover === idx;
            g.fillStyle = o.state === 'right' ? 'rgba(52,211,153,0.18)' : o.state === 'wrong' ? 'rgba(248,113,113,0.16)' : hov ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
            roundRect(g, pad, y0, W, hEst, 18); g.fill();
            g.strokeStyle = o.state === 'right' ? '#34d399' : o.state === 'wrong' ? '#f87171' : hov ? '#f5a524' : 'rgba(255,255,255,0.14)';
            g.lineWidth = 3; g.stroke();
            drawRich(g, o.text, pad + 34, y0 + 22 * s, W - 68, 32 * s, 500, '#e9eef4', 1.3, false);
            if (!b.disabled) this.buttons.push({ x: pad, y: y0, w: W, h: hEst, value: o.value ?? 'opt:' + i });
          }
          y = y0 + hEst + 14 * s;
        });
      }
    }
    return y;
  }
}

/** Mehrzeiliger Text mit **fett**; gibt neue y-Position zurück */
export function drawRich(g, text, x, y, maxW, size, weight, color, lh = 1.35, measureOnly = false) {
  const parts = [];
  String(text).split(/(\*\*.+?\*\*)/g).forEach(seg => {
    if (!seg) return;
    const bold = seg.startsWith('**') && seg.endsWith('**');
    const t = bold ? seg.slice(2, -2) : seg;
    t.split(/(\s+)/).forEach(w => { if (w) parts.push({ w, bold }); });
  });
  const fontN = `${weight} ${size}px Inter, system-ui, sans-serif`;
  const fontB = `800 ${size}px Inter, system-ui, sans-serif`;
  let cx = x, line = [];
  const lines = [];
  for (const p of parts) {
    g.font = p.bold ? fontB : fontN;
    const w = g.measureText(p.w).width;
    if (cx + w > x + maxW && line.length && !/^\s+$/.test(p.w)) { lines.push(line); line = []; cx = x; }
    if (!line.length && /^\s+$/.test(p.w)) continue;
    line.push({ ...p, x: cx, width: w });
    cx += w;
  }
  if (line.length) lines.push(line);
  if (!measureOnly) {
    g.textBaseline = 'top'; g.textAlign = 'left';
    for (const ln of lines) {
      for (const p of ln) { g.font = p.bold ? fontB : fontN; g.fillStyle = p.bold ? '#ffffff' : color; g.fillText(p.w, p.x, y); }
      y += size * lh;
    }
  } else y += lines.length * size * lh;
  return y;
}

// ---------- Kopf-fester Hinweis in VR ----------
function makeHeadToast(engine) {
  const c = document.createElement('canvas'); c.width = 1400; c.height = 180;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.126), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  mesh.position.set(0, -0.2, -1.05);
  mesh.renderOrder = 40;
  mesh.visible = false;
  engine.camera.add(mesh);
  let ttl = 0;
  return {
    show(text, type, ms) {
      if (!engine.isXR) return;
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = 'rgba(10,14,19,0.92)'; roundRect(g, 6, 6, c.width - 12, c.height - 12, 34); g.fill();
      g.fillStyle = { ok: '#34d399', warn: '#fbbf24', error: '#f87171' }[type] || '#2dd4bf';
      g.fillRect(6, 30, 12, c.height - 60);
      const clean = String(text).replace(/\*\*/g, '');
      let size = 48;
      g.font = `600 ${size}px Inter, system-ui, sans-serif`;
      while (g.measureText(clean).width > c.width - 90 && size > 28) { size -= 2; g.font = `600 ${size}px Inter, system-ui, sans-serif`; }
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(clean, c.width / 2 + 6, c.height / 2, c.width - 80);
      tex.needsUpdate = true;
      mesh.visible = true;
      mesh.material.opacity = 1;
      ttl = ms / 1000;
    },
    update(dt) {
      if (!mesh.visible) return;
      ttl -= dt;
      if (ttl < 0.4) mesh.material.opacity = Math.max(0, ttl / 0.4);
      if (ttl <= 0 || !engine.isXR) mesh.visible = false;
    },
  };
}
