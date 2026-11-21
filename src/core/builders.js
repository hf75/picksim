// Prozedurale Bauteile: Fachbodenregale, Sichtlagerkästen, Etiketten-/Verpackungs-Atlanten,
// instanzierte Artikel mit eigener Verpackung je Instanz, Wagen, Schilder.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { boxGeo, mergeToMesh } from './env.js';

// ---------------- Atlas (viele kleine Canvas-Grafiken in einer Textur) ----------------
export class Atlas {
  constructor(ctx, { size = 2048, cellW = 256, cellH = 128, srgb = true } = {}) {
    this.ctx = ctx;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.g = this.canvas.getContext('2d');
    this.size = size; this.cellW = cellW; this.cellH = cellH;
    this.cols = Math.floor(size / cellW); this.rows = Math.floor(size / cellH);
    this.next = 0;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    this.texture.anisotropy = 8;
    ctx.track(this.texture);
  }
  /** zeichnet src (Canvas) in eine Zelle; gibt UV-Rechteck {u,v,w,h} zurück */
  add(src) {
    if (this.next >= this.cols * this.rows) { console.warn('Atlas voll'); return { u: 0, v: 0, w: 0.01, h: 0.01 }; }
    const i = this.next++;
    const cx = (i % this.cols) * this.cellW, cy = Math.floor(i / this.cols) * this.cellH;
    this.g.drawImage(src, cx, cy, this.cellW, this.cellH);
    this.texture.needsUpdate = true;
    const pad = 0.5;
    return { u: (cx + pad) / this.size, v: 1 - (cy + this.cellH - pad) / this.size, w: (this.cellW - 2 * pad) / this.size, h: (this.cellH - 2 * pad) / this.size };
  }
}

/** Material, das pro Instanz einen Atlas-Ausschnitt zeigt (Attribut instUV = offset.xy, scale.xy) */
export function atlasInstancedMaterial(atlasTex, params = {}) {
  const m = new THREE.MeshStandardMaterial({ map: atlasTex, roughness: 0.75, metalness: 0, ...params });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 instUV;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = uv * instUV.zw + instUV.xy;\n#endif');
  };
  m.customProgramCacheKey = () => 'atlasInst';
  return m;
}

/**
 * Instanz-Pool für gleichartige Objekte mit je eigenem Atlas-Ausschnitt.
 * add(matrix, uvRect) → index ; setVisible(index, bool)
 */
export class AtlasInstances {
  constructor(geometry, material, capacity) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.uv = new Float32Array(capacity * 4);
    this.attr = new THREE.InstancedBufferAttribute(this.uv, 4);
    geometry.setAttribute('instUV', this.attr);
    this.matrices = [];
    this.hidden = new Set();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  add(matrix, uv) {
    const i = this.mesh.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.matrices[i] = matrix.clone();
    this.uv.set([uv.u, uv.v, uv.w, uv.h], i * 4);
    this.attr.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    return i;
  }
  setVisible(i, v) {
    if (v) this.hidden.delete(i); else this.hidden.add(i);
    this.mesh.setMatrixAt(i, v ? this.matrices[i] : this._zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  finish() { this.mesh.computeBoundingSphere(); this.mesh.computeBoundingBox && this.mesh.computeBoundingBox(); }
}

/** Instanz-Pool für ein (GLB-)Modell mit mehreren Teilnetzen */
export class ModelInstances {
  constructor(template, capacity, { cast = true } = {}) {
    this.group = new THREE.Group();
    this.parts = [];
    template.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
    template.traverse(o => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, capacity);
      im.count = 0; im.castShadow = cast; im.receiveShadow = true;
      this.parts.push({ im, local: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
      this.group.add(im);
    });
    this.matrices = [];
    this.n = 0;
    this._tmp = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  add(matrix) {
    const i = this.n++;
    this.matrices[i] = matrix.clone();
    for (const p of this.parts) { p.im.count = this.n; p.im.setMatrixAt(i, this._tmp.multiplyMatrices(matrix, p.local)); p.im.instanceMatrix.needsUpdate = true; }
    return i;
  }
  setVisible(i, v) {
    for (const p of this.parts) {
      p.im.setMatrixAt(i, v ? this._tmp.multiplyMatrices(this.matrices[i], p.local) : this._zero);
      p.im.instanceMatrix.needsUpdate = true;
    }
  }
  finish() { for (const p of this.parts) { p.im.computeBoundingSphere(); p.im.computeBoundingBox && p.im.computeBoundingBox(); } }
}

// ---------------- Fachbodenregal ----------------
/**
 * Regalzeile mit Fächern (Sektionen) und Ebenen. Lokale Front zeigt nach +Z.
 * opts: sections, sectionW, depth, height, levels (Array der Bodenhöhen in m), style: 'old'|'galv', back (bool)
 * gibt { group, slots[], footprint } zurück. slot = {section, level, local:{x,y,z}, w, d, clear}
 */
export function shelfRow(ctx, opts) {
  const { mat } = ctx;
  const { sections = 6, sectionW = 1.0, depth = 0.5, height = 2.2, levels = [0.12, 0.55, 0.98, 1.41, 1.84], style = 'old', back = true } = opts;
  const W = sections * sectionW;
  const uprMat = style === 'old' ? mat.pbr('metal_painted', { color: 0x6f8574, repeat: [1, 4], fallbackColor: 0x6f8574, roughness: 0.75, metalness: 0.4 }) : mat.pbr('metal_galvanized', { repeat: [1, 4], fallbackColor: 0xb8bcc0 });
  const boardMat = style === 'old' ? mat.pbr('wood_planks', { repeat: [2, 0.6], fallbackColor: 0x9a7a55, metalness: 0 }) : mat.pbr('metal_galvanized', { repeat: [3, 1], fallbackColor: 0xb8bcc0 });
  const backMat = style === 'old' ? mat.pbr('wood_planks', { repeat: [3, 2], fallbackColor: 0x7a5f45, color: 0xb09a80, metalness: 0 }) : mat.basic(0xa8adb2, 0.6, 0.5);
  const up = [], bd = [], bk = [], br = [];
  const t = 0.035;
  for (let i = 0; i <= sections; i++) {
    const x = -W / 2 + i * sectionW;
    // Winkelprofile vorne & hinten
    up.push(boxGeo(t, height, t, x, height / 2, depth / 2 - t / 2));
    up.push(boxGeo(t, height, t, x, height / 2, -depth / 2 + t / 2));
    if (style === 'galv' || !back) {
      // Seitliche Diagonalen
      const diag = Math.hypot(depth, 0.6);
      for (let y = 0.4; y < height - 0.3; y += 0.6) {
        const gq = new THREE.BoxGeometry(0.012, diag, 0.025);
        gq.rotateX(Math.atan2(depth, 0.6) * (Math.round(y / 0.6) % 2 ? 1 : -1));
        gq.translate(x, y + 0.3, 0);
        br.push(gq);
      }
    }
  }
  for (const ly of levels) {
    const bt = style === 'old' ? 0.025 : 0.018;
    for (let s = 0; s < sections; s++) {
      const x = -W / 2 + (s + 0.5) * sectionW;
      bd.push(boxGeo(sectionW - t * 0.6, bt, depth - 0.01, x, ly - bt / 2, 0));
      if (style === 'galv') bd.push(boxGeo(sectionW - t, 0.035, 0.012, x, ly - 0.02, depth / 2 - 0.006));
    }
  }
  if (back) bk.push(boxGeo(W, height - 0.05, 0.012, 0, height / 2, -depth / 2 + 0.006));
  // Abdeckung oben
  bd.push(boxGeo(W, 0.02, depth, 0, height + 0.01, 0));
  const g = new THREE.Group();
  g.add(mergeToMesh(up, uprMat, { name: 'uprights' }));
  g.add(mergeToMesh(bd, boardMat, { name: 'boards' }));
  if (bk.length) g.add(mergeToMesh(bk, backMat, { name: 'back', cast: false }));
  if (br.length) g.add(mergeToMesh(br, uprMat, { name: 'braces' }));
  if (opts.aoCards !== false) g.add(shelfAOCards(ctx, W, depth, levels, height, back));

  const slots = [];
  levels.forEach((ly, li) => {
    const clear = (levels[li + 1] ?? height) - ly - 0.04;
    for (let s = 0; s < sections; s++) {
      slots.push({ section: s + 1, level: li + 1, local: new THREE.Vector3(-W / 2 + (s + 0.5) * sectionW, ly, 0), w: sectionW - 0.06, d: depth - 0.04, clear });
    }
  });
  g.position.set(opts.x || 0, 0, opts.z || 0);
  g.rotation.y = opts.ry || 0;
  ctx.root.add(g);
  g.updateMatrixWorld(true);
  // Kollision
  const swap = Math.abs(Math.sin(opts.ry || 0)) > 0.7;
  ctx.player.addBoxCentered(opts.x || 0, opts.z || 0, swap ? depth : W, swap ? W : depth, 0, 'shelf');
  for (const sl of slots) {
    sl.world = sl.local.clone().applyMatrix4(g.matrixWorld);
    sl.ry = opts.ry || 0;
    sl.front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), sl.ry);
  }
  return { group: g, slots, width: W, depth, footprint: { x: opts.x || 0, z: opts.z || 0, w: swap ? depth : W, d: swap ? W : depth } };
}

/**
 * Gebackene "Ambient Occlusion" für Regale: dunkle Verlaufskarten auf Fachböden (hinten dunkler)
 * und an der Rückwand (unten an jedem Boden dunkler). Funktioniert auch in VR ohne Post-Processing.
 */
let _aoTex = null;
export function aoGradientTexture() {
  if (_aoTex) return _aoTex;
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  // alphaMap liest den Grünkanal: weiß = deckend (dunkel), schwarz = durchsichtig
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#737373'); gr.addColorStop(1, '#000000');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  _aoTex = new THREE.CanvasTexture(c);
  _aoTex.colorSpace = THREE.NoColorSpace;
  return _aoTex;
}
export function shelfAOCards(ctx, W, depth, levels, height, back, strength = 0.55) {
  const geos = [];
  for (let i = 0; i < levels.length; i++) {
    const ly = levels[i];
    // Bodenkarte: hinten (−Z) dunkel → vorne hell. V=1 (Canvas oben, dunkel) liegt hinten.
    const p = new THREE.PlaneGeometry(W, depth * 0.95);
    p.rotateX(-Math.PI / 2);
    p.translate(0, ly + 0.002, -depth * 0.025);
    geos.push(p);
    // Unterseite des darüberliegenden Bodens wirft Schatten auf die Rückwand: vertikale Karte (oben dunkel)
    const top = (levels[i + 1] ?? height);
    const hh = Math.min(0.22, (top - ly) * 0.6);
    if (back) {
      const v = new THREE.PlaneGeometry(W, hh);
      v.translate(0, top - hh / 2 - 0.02, -depth / 2 + 0.014);
      geos.push(v);
    }
    // Kontaktschatten an der Rückwand direkt über dem Boden (unten dunkel)
    if (back) {
      const v2 = new THREE.PlaneGeometry(W, 0.12);
      v2.rotateZ(Math.PI);
      v2.translate(0, ly + 0.06, -depth / 2 + 0.014);
      geos.push(v2);
    }
  }
  const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: aoGradientTexture(), transparent: true, opacity: strength, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  geos.forEach(x => x.dispose());
  m.name = 'shelf-ao';
  m.renderOrder = 1;
  m.userData.noEnvCapture = false;
  return m;
}

/**
 * Etikettenleisten an Fächern: labels = [{slot, uv}] ; erzeugt ein Mesh (ein Draw-Call)
 */
export function labelStrips(ctx, group, items, atlasTex, { w = 0.16, h = 0.055, inset = 0.003, yOff = -0.035 } = {}) {
  const geos = items.map(({ local, uv, depth, width, ww, hh }) => {
    const pg = new THREE.PlaneGeometry(ww || width || w, hh || h);
    const a = pg.attributes.uv;
    for (let i = 0; i < a.count; i++) a.setXY(i, uv.u + a.getX(i) * uv.w, uv.v + a.getY(i) * uv.h);
    pg.translate(local.x, local.y + yOff, local.z + depth / 2 + inset);
    return pg;
  });
  if (!geos.length) return null;
  const m = mergeToMesh(geos, new THREE.MeshStandardMaterial({ map: atlasTex, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 }), { cast: false, name: 'labels' });
  group.add(m);
  return m;
}

// ---------------- Sichtlagerkasten ----------------
/** Geometrie eines Sichtlagerkastens (offene, abgeschrägte Front). Maße in m, Front +Z, Boden y=0 */
export function binGeometry(w = 0.15, h = 0.13, d = 0.35) {
  const t = 0.004;
  const parts = [];
  parts.push(boxGeo(w, t, d, 0, t / 2, 0));                  // Boden
  parts.push(boxGeo(w, h, t, 0, h / 2, -d / 2 + t / 2));      // Rückwand
  // Seiten mit Schräge: als Shape extrudiert
  const sh = new THREE.Shape();
  sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(d / 2, h * 0.45); sh.lineTo(d / 2 - d * 0.28, h); sh.lineTo(-d / 2, h); sh.closePath();
  for (const sx of [-1, 1]) {
    const eg = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
    eg.rotateY(-Math.PI / 2);
    eg.translate(sx * (w / 2) + (sx < 0 ? t : 0), 0, 0);
    parts.push(eg);
  }
  parts.push(boxGeo(w, h * 0.45, t, 0, h * 0.225, d / 2 - t / 2));   // Frontblende
  // Griffleiste
  parts.push(boxGeo(w * 0.7, 0.012, 0.02, 0, h * 0.45 - 0.006, d / 2 + 0.006));
  const geo = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p), false);
  parts.forEach(p => p.dispose());
  geo.computeVertexNormals();
  return geo;
}

// ---------------- Kleinteile-Schachtel ----------------
export function packBoxGeometry(w, h, d, radius = 0.004) {
  return new RoundedBoxGeometry(w, h, d, 2, radius);
}

// ---------------- Kommissionierwagen (Fallback, falls kein Modell) ----------------
export function simpleCart(ctx, { w = 0.9, d = 0.55, h = 0.95, color = 0x3b6fb6 } = {}) {
  const { mat } = ctx;
  const g = new THREE.Group();
  const frame = mat.basic(color, 0.45, 0.6);
  const shelf = mat.pbr('metal_galvanized', { repeat: [2, 1], fallbackColor: 0xb8bcc0 });
  const geos = [];
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) geos.push(boxGeo(0.025, h - 0.1, 0.025, x, 0.1 + (h - 0.1) / 2, z));
  g.add(mergeToMesh(geos, frame));
  const sg = [boxGeo(w, 0.02, d, 0, 0.22, 0), boxGeo(w, 0.02, d, 0, 0.62, 0)];
  g.add(mergeToMesh(sg, shelf));
  // Schiebebügel
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, d + 0.06, 12), frame);
  bar.rotation.x = Math.PI / 2; bar.position.set(w / 2 + 0.04, h, 0);
  g.add(bar);
  // Räder
  const wheelG = new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16); wheelG.rotateX(Math.PI / 2);
  const wm = mat.basic(0x1d1f22, 0.6, 0);
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) { const m = new THREE.Mesh(wheelG, wm); m.position.set(x, 0.05, z); g.add(m); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Wand-/Hängeschild aus Canvas */
export function signMesh(ctx, canvas, w, h, { emissive = 0, doubleSided = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  ctx.track(tex);
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide, emissive: emissive ? 0xffffff : 0x000000, emissiveMap: emissive ? tex : null, emissiveIntensity: emissive });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.castShadow = false; mesh.receiveShadow = true;
  return mesh;
}

/** Außenansicht für Fenster: Himmel mit Wolken, Silhouette von Gebäuden/Bäumen (wird leuchtend dargestellt) */
let _outsideTex = null;
export function outsideTexture() {
  if (_outsideTex) return _outsideTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#9cc4ee'); sky.addColorStop(0.6, '#dcebf7'); sky.addColorStop(1, '#f4f1e6');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 18; i++) { g.beginPath(); g.ellipse(Math.random() * 512, 30 + Math.random() * 70, 30 + Math.random() * 50, 8 + Math.random() * 10, 0, 0, 7); g.fill(); }
  // Hintergrund: Häuser & Bäume
  g.fillStyle = '#9aa6a6';
  for (let x = 0; x < 512; x += 40 + Math.random() * 30) { const h = 40 + Math.random() * 70; g.fillRect(x, 256 - h, 30 + Math.random() * 30, h); }
  g.fillStyle = '#6f8a6a';
  for (let x = 0; x < 540; x += 22) { g.beginPath(); g.arc(x, 240 - Math.random() * 25, 18 + Math.random() * 14, 0, 7); g.fill(); }
  _outsideTex = new THREE.CanvasTexture(c);
  _outsideTex.colorSpace = THREE.SRGBColorSpace;
  return _outsideTex;
}

/** Fenster (Rahmen + hell leuchtendes Glas mit Außenansicht, Sprossen) – auf eine Wand gesetzt, Front +Z */
export function windowMesh(ctx, { w = 1.6, h = 1.4, frameColor = 0x2e3a30, glow = 0.95, glowColor = 0xdfefff, cols = 3, rows = 2, outside = true } = {}) {
  const g = new THREE.Group();
  const fm = ctx.mat.basic(frameColor, 0.6, 0.3);
  const glass = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: outside ? 0xffffff : glowColor, emissiveMap: outside ? outsideTexture() : null, emissiveIntensity: glow, roughness: 0.1 });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass);
  pane.position.z = 0.01;
  g.add(pane);
  const geos = [];
  const ft = 0.06;
  geos.push(boxGeo(w + ft, ft, 0.08, 0, h / 2, 0.03), boxGeo(w + ft, ft, 0.08, 0, -h / 2, 0.03), boxGeo(ft, h, 0.08, -w / 2, 0, 0.03), boxGeo(ft, h, 0.08, w / 2, 0, 0.03));
  for (let i = 1; i < cols; i++) geos.push(boxGeo(0.03, h, 0.05, -w / 2 + i * w / cols, 0, 0.03));
  for (let j = 1; j < rows; j++) geos.push(boxGeo(w, 0.03, 0.05, 0, -h / 2 + j * h / rows, 0.03));
  geos.push(boxGeo(w + 0.16, 0.05, 0.16, 0, -h / 2 - 0.03, 0.08));   // Fensterbank
  g.add(mergeToMesh(geos, fm, { cast: false }));
  return g;
}
