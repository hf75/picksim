// Lager 03 – prozedurale Bauteile: Durchlaufregal, KLT-Behälter, Pick-to-Light-Module, Multi-Order-Wagen,
// Rollenbahnen, Terminal, Verpackungsregal.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxGeo, mergeToMesh } from '../../core/env.js';
import { aoGradientTexture } from '../../core/builders.js';
import { makeCanvas, MONO, FONT } from '../../core/canvas.js';
import { roundRect } from '../../core/interaction.js';

export const TEAL = 0x14b8a6;
export const ANTHRAZIT = 0x2f3640;

/** Material-Patch: pro Instanz eigener Atlas-Ausschnitt (instUV) – für beliebige Materialien */
export function patchInstancedUV(material, key) {
  material.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 instUV;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = uv * instUV.zw + instUV.xy;\n#endif');
  };
  material.customProgramCacheKey = () => 'instUV-' + key;
  return material;
}

/** Einheitswürfel, Vorderseite (+Z) zeigt die ganze Atlaszelle, die übrigen Seiten einen Farbstreifen */
export function unitBoxFrontUV(sideU = [0.955, 0.99], sideV = [0.79, 0.96]) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv;
  for (let face = 0; face < 6; face++) {
    if (face === 4) continue;
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      uv.setXY(k, sideU[0] + uv.getX(k) * (sideU[1] - sideU[0]), sideV[0] + uv.getY(k) * (sideV[1] - sideV[0]));
    }
  }
  return g;
}

/** offener Kleinladungsträger (KLT). Maße außen; Boden y=0, Front +Z */
export function toteGeometry(w, h, d, t = 0.008) {
  const parts = [
    boxGeo(w, t, d, 0, t / 2, 0),
    boxGeo(w, h, t, 0, h / 2, -d / 2 + t / 2),
    boxGeo(w, h * 0.78, t, 0, h * 0.39, d / 2 - t / 2),
    boxGeo(t, h, d, -w / 2 + t / 2, h / 2, 0),
    boxGeo(t, h, d, w / 2 - t / 2, h / 2, 0),
    // umlaufender Rand
    boxGeo(w + 0.006, 0.012, 0.016, 0, h - 0.006, -d / 2 + 0.008),
    boxGeo(0.016, 0.012, d + 0.006, -w / 2 + 0.008, h - 0.006, 0),
    boxGeo(0.016, 0.012, d + 0.006, w / 2 - 0.008, h - 0.006, 0),
    // Griffleisten / Etikettenhalter vorne
    boxGeo(w * 0.62, 0.05, 0.006, 0, h * 0.42, d / 2 + 0.003),
  ];
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return g;
}

/** Streifentextur für Rollenbahnen (Röllchen) */
let _rollerTex = null;
export function rollerTexture() {
  if (_rollerTex) return _rollerTex;
  const c = makeCanvas(64, 256), g = c.getContext('2d');
  g.fillStyle = '#6b7280'; g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 32) {
    const gr = g.createLinearGradient(0, y, 0, y + 28);
    gr.addColorStop(0, '#3f4650'); gr.addColorStop(0.45, '#d6dbe1'); gr.addColorStop(1, '#4b525c');
    g.fillStyle = gr; g.fillRect(4, y + 2, 56, 26);
  }
  _rollerTex = new THREE.CanvasTexture(c);
  _rollerTex.colorSpace = THREE.SRGBColorSpace;
  _rollerTex.wrapS = _rollerTex.wrapT = THREE.RepeatWrapping;
  _rollerTex.anisotropy = 8;
  return _rollerTex;
}

/**
 * Durchlaufregal-Zeile. Lokale Front (Pickseite) bei z=0 Richtung +Z, Tiefe nach −Z.
 * Gibt { group, lanes[], footprint, width } zurück. lane = {bay, level, lane, x, frontY, angle}
 */
export function flowRackRow(ctx, { x = 0, z = 0, ry = 0, bays = 5, bayW = 1.2, depth = 1.5, frontYs = [0.4, 0.88, 1.36], rise = 0.16, lanesPerBay = 3, postH = 1.98 }) {
  const { mat } = ctx;
  const W = bays * bayW;
  const g = new THREE.Group();
  g.name = 'flowrack';
  const frameMat = mat.pbr('metal_painted', { color: 0x3a414c, repeat: [1, 3], fallbackColor: 0x3a414c, roughness: 0.6, metalness: 0.5 });
  const beamMat = mat.basic(0x0d9488, 0.38, 0.35);
  const alu = mat.pbr('metal_galvanized', { color: 0xd7dde3, repeat: [4, 1], fallbackColor: 0xc9ced4, tag: 'alu' });
  const posts = [], beams = [], rails = [], tracks = [], guides = [];
  const angle = Math.atan2(rise, depth);
  for (let i = 0; i <= bays; i++) {
    const px = -W / 2 + i * bayW;
    posts.push(boxGeo(0.07, postH, 0.07, px, postH / 2, -0.035));
    posts.push(boxGeo(0.07, postH + rise, 0.07, px, (postH + rise) / 2, -depth + 0.035));
    // Seitenrahmen: Diagonalen
    for (let k = 0; k < 3; k++) {
      const y0 = 0.15 + k * 0.6;
      const dg = new THREE.BoxGeometry(0.03, Math.hypot(depth - 0.1, 0.6), 0.03);
      dg.rotateX((k % 2 ? 1 : -1) * Math.atan2(depth - 0.1, 0.6));
      dg.translate(px, y0 + 0.3, -depth / 2);
      posts.push(dg);
    }
    posts.push(boxGeo(0.05, 0.05, depth - 0.14, px, 0.06, -depth / 2));   // Bodenholm zwischen vorderem und hinterem Ständer
  }
  // Keine Fläche darf deckungsgleich mit einer Ständerfläche liegen (sonst Z-Fighting, das beim Gehen flackert):
  // Traversen enden in den äußeren Ständern und sitzen 5 mm hinter der Ständervorderkante.
  for (const fy of frontYs) {
    beams.push(boxGeo(W, 0.07, 0.05, 0, fy - 0.035, -0.03));                         // vordere Traverse (türkis)
    beams.push(boxGeo(W, 0.07, 0.05, 0, fy + rise - 0.035, -depth + 0.03));          // hintere Traverse
    rails.push(boxGeo(W, 0.066, 0.025, 0, fy - 0.035, 0.0125));                       // PTL-Schiene (Alu)
    // Rollenbahnen je Lane (2 Spuren) + Führungsleisten
    for (let b = 0; b < bays; b++) {
      for (let l = 0; l < lanesPerBay; l++) {
        const lx = -W / 2 + b * bayW + (l + 0.5) * bayW / lanesPerBay;
        const lw = bayW / lanesPerBay;
        for (const s of [-1, 1]) {
          const tg = new THREE.BoxGeometry(0.06, 0.02, depth - 0.06);
          tg.rotateX(angle);
          tg.translate(lx + s * lw * 0.27, fy + rise / 2 - 0.01, -depth / 2);
          tracks.push(tg);
        }
        if (l > 0 || b > 0) {
          const gx = -W / 2 + b * bayW + l * lw;
          const gg = new THREE.BoxGeometry(0.012, 0.05, depth - 0.1);
          gg.rotateX(angle);
          gg.translate(gx, fy + rise / 2 + 0.02, -depth / 2);
          guides.push(gg);
        }
      }
    }
  }
  // Kopfträger oben (für Zonenschild): steht seitlich und oben je 5 mm über die Ständer hinaus
  beams.push(boxGeo(W + 0.08, 0.12, 0.06, 0, postH - 0.055, -0.035));
  g.add(mergeToMesh(posts, frameMat, { name: 'posts' }));
  g.add(mergeToMesh(beams, beamMat, { name: 'beams' }));
  g.add(mergeToMesh(rails, alu, { name: 'ptl-rails' }));
  g.add(mergeToMesh(guides, alu, { name: 'guides', cast: false }));
  // Rollen mit Streifentextur: UVs entlang der Bahn kacheln
  const tm = mergeGeometries(tracks);
  tracks.forEach(t => t.dispose());
  const trackMat = new THREE.MeshStandardMaterial({ map: rollerTexture(), roughness: 0.35, metalness: 0.7 });
  trackMat.map = rollerTexture().clone(); trackMat.map.repeat.set(1, Math.round(depth / 0.04)); trackMat.map.needsUpdate = true;
  ctx.track(trackMat.map); ctx.track(trackMat);
  const trackMesh = new THREE.Mesh(tm, trackMat);
  trackMesh.receiveShadow = true;
  g.add(trackMesh);
  // AO-Karten unter jeder Ebene (verdunkelt die Fachtiefe)
  const ao = [];
  for (const fy of frontYs) {
    const p = new THREE.PlaneGeometry(W, depth);
    p.rotateX(-Math.PI / 2);
    p.rotateX(angle);
    p.translate(0, fy + rise / 2 + 0.003, -depth / 2);
    ao.push(p);
  }
  const aoMesh = new THREE.Mesh(mergeGeometries(ao), new THREE.MeshBasicMaterial({ color: 0, alphaMap: aoGradientTexture(), transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  ao.forEach(p => p.dispose());
  aoMesh.renderOrder = 1;
  g.add(aoMesh);

  const lanes = [];
  frontYs.forEach((fy, li) => {
    for (let b = 0; b < bays; b++) for (let l = 0; l < lanesPerBay; l++) {
      lanes.push({ bay: b + 1, level: li + 1, lane: l + 1, x: -W / 2 + b * bayW + (l + 0.5) * bayW / lanesPerBay, frontY: fy, angle, width: bayW / lanesPerBay });
    }
  });
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.root.add(g);
  g.updateMatrixWorld(true);
  const swap = Math.abs(Math.sin(ry)) > 0.7;
  // Kollision: Mittelpunkt der Regaltiefe
  const c = new THREE.Vector3(0, 0, -depth / 2).applyMatrix4(g.matrixWorld);
  ctx.player.addBoxCentered(c.x, c.z, swap ? depth : W + 0.1, swap ? W + 0.1 : depth, 0, 'flowrack');
  return { group: g, lanes, width: W, depth, rise, footprint: { x: c.x, z: c.z, w: swap ? depth : W, d: swap ? W : depth } };
}

/** Ziffern-Atlas für LED-Displays: Zellen 0=leer, 1..40 = Zahlen, 41 = OK, 42 = E, 43 = --, 44 = ✓ */
export function ledAtlas(ctx, { color = '#ff453a', cellW = 128, cellH = 64 } = {}) {
  const cols = 8, rows = 6;
  const c = makeCanvas(cols * cellW, rows * cellH), g = c.getContext('2d');
  const cells = [];
  const draw = (i, txt, col) => {
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
    g.fillStyle = '#050608'; g.fillRect(x, y, cellW, cellH);
    g.font = `800 ${cellH * 0.78}px ${MONO}`; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,60,50,0.07)'; g.fillText('88', x + cellW - 10, y + cellH / 2 + 3);   // "Geister-Segmente"
    if (txt) { g.fillStyle = col || color; g.fillText(txt, x + cellW - 10, y + cellH / 2 + 3); }
    cells[i] = { u: (x + 1) / c.width, v: 1 - (y + cellH - 1) / c.height, w: (cellW - 2) / c.width, h: (cellH - 2) / c.height };
  };
  draw(0, '');
  for (let n = 1; n <= 40; n++) draw(n, String(n));
  draw(41, 'OK', '#34d399');
  draw(42, 'E', '#ff453a');
  draw(43, '--', '#ffb020');
  draw(44, '✓', '#34d399');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  ctx.track(tex);
  return { tex, cells, cellFor: v => (typeof v === 'number' ? cells[Math.max(0, Math.min(40, v))] : cells[{ OK: 41, E: 42, '--': 43, '✓': 44 }[v] ?? 0]) };
}

/** Pick-to-Light-Module für viele Fächer (3 InstancedMeshes: Gehäuse, Display, Taste) */
export class PTLModules {
  constructor(ctx, atlas, capacity) {
    this.atlas = atlas;
    const housingGeo = new THREE.BoxGeometry(0.115, 0.056, 0.03);
    const dispGeo = new THREE.PlaneGeometry(0.06, 0.03);
    const btnGeo = new THREE.CylinderGeometry(0.0135, 0.0135, 0.012, 20); btnGeo.rotateX(Math.PI / 2);
    ctx.track(housingGeo); ctx.track(dispGeo); ctx.track(btnGeo);
    this.housing = new THREE.InstancedMesh(housingGeo, ctx.mat.basic(0x1d2127, 0.45, 0.2), capacity);
    const dm = patchInstancedUV(new THREE.MeshBasicMaterial({ map: atlas.tex, toneMapped: true }), 'ptl');
    dm.color.setScalar(2.6);
    ctx.track(dm);
    this.display = new THREE.InstancedMesh(dispGeo, dm, capacity);
    this.uv = new Float32Array(capacity * 4);
    this.uvAttr = new THREE.InstancedBufferAttribute(this.uv, 4);
    dispGeo.setAttribute('instUV', this.uvAttr);
    const bm = new THREE.MeshBasicMaterial({ color: 0xffffff });
    ctx.track(bm);
    this.button = new THREE.InstancedMesh(btnGeo, bm, capacity);
    for (const m of [this.housing, this.display, this.button]) { m.count = 0; m.castShadow = false; m.receiveShadow = false; }
    this.housing.castShadow = true;
    this.n = 0;
    this._c = new THREE.Color();
    this.group = new THREE.Group();
    this.group.add(this.housing, this.display, this.button);
  }
  /** Modul in Weltkoordinaten hinzufügen (matrix = Position/Drehung der Modulmitte, Front +Z) */
  add(matrix) {
    const i = this.n++;
    const m = new THREE.Matrix4();
    this.housing.setMatrixAt(i, matrix);
    this.display.setMatrixAt(i, m.copy(matrix).multiply(new THREE.Matrix4().makeTranslation(-0.02, 0, 0.0155)));
    this.button.setMatrixAt(i, m.copy(matrix).multiply(new THREE.Matrix4().makeTranslation(0.037, 0, 0.018)));
    for (const x of [this.housing, this.display, this.button]) { x.count = this.n; x.instanceMatrix.needsUpdate = true; }
    this.setDisplay(i, 0);
    this.setButton(i, 'off');
    return i;
  }
  setDisplay(i, v) {
    const c = this.atlas.cellFor(v);
    this.uv.set([c.u, c.v, c.w, c.h], i * 4);
    this.uvAttr.needsUpdate = true;
  }
  /** state: off | green | red | amber | dim */
  setButton(i, state) {
    const col = { off: [0.06, 0.07, 0.08], green: [0.15, 3.2, 0.9], red: [3.2, 0.25, 0.2], amber: [3.0, 1.6, 0.1], dim: [0.05, 0.6, 0.25] }[state] || [0.06, 0.07, 0.08];
    this.button.setColorAt(i, this._c.setRGB(col[0], col[1], col[2]));
    this.button.instanceColor.needsUpdate = true;
  }
  finish() { for (const x of [this.housing, this.display, this.button]) { x.computeBoundingSphere(); } }
}

/** einzelnes LED-Display (für den Wagen) als Mesh mit eigener UV-Verschiebung */
export function singleDisplay(ctx, atlas, w = 0.06, h = 0.03) {
  const tex = atlas.tex.clone();
  tex.needsUpdate = true;
  ctx.track(tex);
  const m = new THREE.MeshBasicMaterial({ map: tex });
  m.color.setScalar(2.6);
  ctx.track(m);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  ctx.track(mesh.geometry);
  mesh.userData.set = v => { const c = atlas.cellFor(v); tex.offset.set(c.u, c.v); tex.repeat.set(c.w, c.h); };
  mesh.userData.set(0);
  return mesh;
}

/**
 * Multi-Order-Kommissionierwagen mit 6 Auftragsbehältern (2 Ebenen × 3), Put-to-Light-Displays, Terminal.
 * Schiebebügel/Bedienseite bei +Z (zeigt zum Spieler, wenn angekoppelt).
 */
export function multiOrderCart(ctx, atlas, screenTexture) {
  const { mat } = ctx;
  const g = new THREE.Group();
  g.name = 'mo-cart';
  const alu = mat.pbr('metal_galvanized', { color: 0xe3e7ec, repeat: [1, 2], fallbackColor: 0xc9ced4, tag: 'alu' });
  const dark = mat.basic(0x2b3038, 0.5, 0.3);
  const W = 0.94, D = 0.6;
  const shelfYs = [0.38, 0.8];
  const geos = [];
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) geos.push(boxGeo(0.03, 1.02, 0.03, x, 0.14 + 0.51, z));
  for (const y of shelfYs) {
    geos.push(boxGeo(W, 0.03, 0.03, 0, y, -D / 2), boxGeo(W, 0.03, 0.03, 0, y, D / 2), boxGeo(0.03, 0.03, D, -W / 2, y, 0), boxGeo(0.03, 0.03, D, W / 2, y, 0));
  }
  geos.push(boxGeo(W, 0.03, 0.03, 0, 0.16, -D / 2), boxGeo(W, 0.03, 0.03, 0, 0.16, D / 2));
  g.add(mergeToMesh(geos, alu, { name: 'frame' }));
  const shelves = shelfYs.map(y => boxGeo(W - 0.04, 0.012, D - 0.04, 0, y + 0.012, 0));
  g.add(mergeToMesh(shelves, mat.basic(0x8b939e, 0.55, 0.5), { name: 'shelves' }));
  // Schiebebügel, Arme, Stange, Gabeln (ein Mesh)
  const darkGeos = [];
  const barG = new THREE.CylinderGeometry(0.016, 0.016, W + 0.06, 16); barG.rotateZ(Math.PI / 2); barG.translate(0, 1.12, D / 2 + 0.07); darkGeos.push(barG);
  for (const s of [-1, 1]) darkGeos.push(boxGeo(0.025, 0.025, 0.1, s * W / 2, 1.12, D / 2 + 0.03));
  const poleG = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 10); poleG.translate(W / 2 - 0.08, 1.28, D / 2 + 0.02); darkGeos.push(poleG);
  const wheelGeos = [];
  for (const [x, z] of [[-W / 2 + 0.05, -D / 2 + 0.05], [W / 2 - 0.05, -D / 2 + 0.05], [-W / 2 + 0.05, D / 2 - 0.05], [W / 2 - 0.05, D / 2 - 0.05]]) {
    const wg = new THREE.CylinderGeometry(0.055, 0.055, 0.035, 18); wg.rotateZ(Math.PI / 2); wg.translate(x, 0.055, z); wheelGeos.push(wg);
    darkGeos.push(boxGeo(0.05, 0.07, 0.04, x, 0.12, z));
  }
  // Behälter (instanziert), Nummernschilder + Put-to-Light-Displays (je ein gemeinsamer Canvas)
  const toteGeo = toteGeometry(0.28, 0.18, 0.42);
  ctx.track(toteGeo);
  const toteInst = new THREE.InstancedMesh(toteGeo, mat.basic(0xffffff, 0.5, 0), 6);
  toteInst.castShadow = true; toteInst.receiveShadow = true;
  const plateCanvas = makeCanvas(768, 128), pg = plateCanvas.getContext('2d');
  const dispCanvas = makeCanvas(768, 64), dg = dispCanvas.getContext('2d');
  const plateGeos = [], dispGeos = [], housingGeos = [];
  const totes = [];
  const xs = [-0.3, 0, 0.3];
  const cellQuad = (w, h, x, y, z, i, n) => { const q = new THREE.PlaneGeometry(w, h); const uv = q.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / n); q.translate(x, y, z); return q; };
  const btnInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 18).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), 6);
  ctx.track(btnInst.geometry); ctx.track(btnInst.material);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) {
    const level = i < 3 ? 1 : 0;   // Behälter 1–3 oben, 4–6 unten
    const x = xs[i % 3];
    const y = shelfYs[level] + 0.02;
    toteInst.setMatrixAt(i, m4.makeTranslation(x, y, -0.04));
    toteInst.setColorAt(i, new THREE.Color(i < 3 ? 0x0e7490 : 0x155e75));
    pg.fillStyle = '#f8fafc'; roundRect(pg, i * 128 + 4, 4, 120, 120, 14); pg.fill();
    pg.fillStyle = '#0f172a'; pg.font = `900 92px ${FONT}`; pg.textAlign = 'center'; pg.textBaseline = 'middle'; pg.fillText(String(i + 1), i * 128 + 64, 70);
    plateGeos.push(cellQuad(0.06, 0.06, x - 0.08, y + 0.08, 0.175, i, 6));
    // Put-Light direkt an der Behälterfront (neben der Nummer) – eindeutig zugeordnet
    const my = y + 0.115, mz = 0.17 + 0.016;
    housingGeos.push(boxGeo(0.11, 0.05, 0.03, x + 0.06, my, mz));
    dispGeos.push(cellQuad(0.055, 0.028, x + 0.04, my, mz + 0.0155, i, 6));
    btnInst.setMatrixAt(i, m4.makeTranslation(x + 0.095, my, mz + 0.018));
    btnInst.setColorAt(i, new THREE.Color(0.06, 0.06, 0.06));
    totes.push({ index: i, pos: new THREE.Vector3(x, y, -0.04), items: [] });
  }
  toteInst.instanceColor.needsUpdate = true;
  g.add(toteInst);
  g.add(mergeToMesh(darkGeos, dark, { name: 'cart-dark' }));
  g.add(mergeToMesh(wheelGeos, mat.basic(0x15171a, 0.7, 0), { name: 'cart-wheels' }));
  g.add(mergeToMesh(housingGeos, mat.basic(0x1d2127, 0.45, 0.2), { name: 'cart-ptl', cast: false }));
  const plateTex = new THREE.CanvasTexture(plateCanvas); plateTex.colorSpace = THREE.SRGBColorSpace; ctx.track(plateTex);
  g.add(mergeToMesh(plateGeos, new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }), { name: 'cart-plates', cast: false }));
  const dispTex = new THREE.CanvasTexture(dispCanvas); dispTex.colorSpace = THREE.SRGBColorSpace; ctx.track(dispTex);
  const dispMat = new THREE.MeshBasicMaterial({ map: dispTex }); dispMat.color.setScalar(2.6); ctx.track(dispMat);
  g.add(mergeToMesh(dispGeos, dispMat, { name: 'cart-displays', cast: false }));
  btnInst.castShadow = false;
  g.add(btnInst);
  // Anzeige-Steuerung: Ziffern direkt in den gemeinsamen Canvas zeichnen
  const drawDisp = (i, v) => {
    const x = i * 128;
    dg.fillStyle = '#050608'; dg.fillRect(x, 0, 128, 64);
    dg.font = `800 50px ${MONO}`; dg.textAlign = 'right'; dg.textBaseline = 'middle';
    dg.fillStyle = 'rgba(255,60,50,0.07)'; dg.fillText('88', x + 118, 35);
    if (v !== 0 && v != null) { dg.fillStyle = v === 'OK' || v === '✓' ? '#34d399' : v === '--' ? '#ffb020' : '#ff453a'; dg.fillText(String(v), x + 118, 35); }
    dispTex.needsUpdate = true;
  };
  for (let i = 0; i < 6; i++) drawDisp(i, 0);
  const _c = new THREE.Color();
  g.userData.setDisplay = drawDisp;
  g.userData.setButton = (i, rgb) => { btnInst.setColorAt(i, _c.setRGB(rgb[0], rgb[1], rgb[2])); btnInst.instanceColor.needsUpdate = true; };
  // Terminal (Tablet) am Bügel
  const tab = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.37, 0.018), mat.basic(0x111418, 0.4, 0.2));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.345), new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false }));
  scr.position.z = 0.0095;
  tab.add(frame, scr);
  tab.position.set(W / 2 - 0.08, 1.5, D / 2 + 0.03);
  tab.rotation.x = -0.35;
  g.add(tab);
  g.userData.screen = scr;
  g.traverse(o => { if (o.isMesh) o.receiveShadow = o !== scr; });
  return { group: g, totes, width: W, depth: D, setDisplay: drawDisp, setButton: g.userData.setButton };
}

/**
 * Rollenbahn entlang einer Polyline (Punkte in XZ). Gibt { group, length, pointAt(s) } zurück.
 */
export function rollerConveyor(ctx, points, { width = 0.6, height = 0.82 } = {}) {
  const { mat } = ctx;
  const frame = mat.pbr('metal_painted', { color: 0x1e3a5f, repeat: [4, 1], fallbackColor: 0x1e3a5f, roughness: 0.5, metalness: 0.5, tag: 'conv' });
  const legs = mat.basic(0x9aa3ad, 0.5, 0.6);
  const rollerMat = new THREE.MeshStandardMaterial({ map: rollerTexture().clone(), roughness: 0.3, metalness: 0.8 });
  ctx.track(rollerMat); ctx.track(rollerMat.map);
  const fg = [], lg = [], rg = [];
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    for (const s of [-1, 1]) {
      const sg = new THREE.BoxGeometry(0.05, 0.12, len + 0.05);
      sg.translate(s * (width / 2 + 0.025), height - 0.03, 0);
      sg.rotateY(ang); sg.translate(cx, 0, cz);
      fg.push(sg);
    }
    const top = new THREE.BoxGeometry(width, 0.035, len);
    // UV entlang der Länge kacheln
    const uv = top.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), uv.getY(k) * len / 0.1);
    top.translate(0, height - 0.02, 0); top.rotateY(ang); top.translate(cx, 0, cz);
    rg.push(top);
    const nLegs = Math.max(1, Math.round(len / 1.6));
    for (let k = 0; k <= nLegs; k++) {
      const t = k / nLegs;
      const px = a.x + dx * t, pz = a.z + dz * t;
      for (const s of [-1, 1]) {
        const lgG = new THREE.BoxGeometry(0.05, height - 0.06, 0.05);
        lgG.translate(s * (width / 2 + 0.025), (height - 0.06) / 2, 0); lgG.rotateY(ang); lgG.translate(px, 0, pz);
        lg.push(lgG);
      }
    }
    segs.push({ a, b, len, start: total, ang });
    total += len;
  }
  const g = new THREE.Group();
  g.add(mergeToMesh(fg, frame, { name: 'conv-frame' }));
  g.add(mergeToMesh(lg, legs, { name: 'conv-legs' }));
  const rm = mergeToMesh(rg, rollerMat, { name: 'conv-rollers' });
  g.add(rm);
  ctx.root.add(g);
  const pointAt = (s, out = new THREE.Vector3()) => {
    s = ((s % total) + total) % total;
    const seg = segs.find(q => s <= q.start + q.len) || segs[segs.length - 1];
    const t = (s - seg.start) / seg.len;
    out.set(seg.a.x + (seg.b.x - seg.a.x) * t, height, seg.a.z + (seg.b.z - seg.a.z) * t);
    out.ang = seg.ang;
    return out;
  };
  return { group: g, length: total, pointAt, rollerMap: rollerMat.map, height, segs };
}

/** Batch-Terminal (Säule mit schrägem Bildschirm) */
export function kiosk(ctx, screenTexture) {
  const { mat } = ctx;
  const g = new THREE.Group();
  const body = mat.basic(0xe8ecf0, 0.4, 0.1);
  const dark = mat.basic(0x1f2937, 0.4, 0.3);
  const teal = mat.basic(TEAL, 0.4, 0.2);
  g.add(mergeToMesh([boxGeo(0.5, 0.04, 0.4, 0, 0.02, 0)], dark));
  g.add(mergeToMesh([boxGeo(0.22, 1.08, 0.16, 0, 0.58, -0.02)], body));
  g.add(mergeToMesh([boxGeo(0.225, 0.08, 0.165, 0, 0.9, -0.02)], teal));
  const head = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.05), dark);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.32), new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false }));
  scr.position.z = 0.026;
  head.add(frame, scr);
  head.position.set(0, 1.27, 0.02);
  head.rotation.x = -0.45;
  g.add(head);
  g.traverse(o => { if (o.isMesh && o !== scr) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Karton-Textur (Wellpappe mit Klebeband) */
let _cardboard = null;
export function cardboardTexture() {
  if (_cardboard) return _cardboard;
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#c69c6d'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1200; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${60 + Math.random() * 40},30,${Math.random() * 0.06})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  g.fillStyle = 'rgba(140,100,60,0.18)'; for (let x = 0; x < 256; x += 6) g.fillRect(x, 0, 1, 256);
  g.fillStyle = 'rgba(214,190,150,0.75)'; g.fillRect(112, 0, 32, 256);
  _cardboard = new THREE.CanvasTexture(c);
  _cardboard.colorSpace = THREE.SRGBColorSpace;
  _cardboard.anisotropy = 4;
  return _cardboard;
}
