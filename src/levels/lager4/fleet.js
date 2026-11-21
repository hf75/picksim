// Lager 4 – Roboterflotte (WCS): Raster, Pods und AMR (instanziert), Wegplanung mit Zellreservierung,
// Disponent, Warteschlange an der Station, Laden, Umlagern im Hintergrund, Not-Halt.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxGeo } from '../../core/env.js';
import { RNG } from './catalog.js';

export const GRID = { C: 1.25, NX: 19, NZ: 13, X0: -14.25, Z0: -7.5 };
export const cxw = i => GRID.X0 + i * GRID.C;
export const czw = j => GRID.Z0 + j * GRID.C;
const KEY = (i, j) => i * 64 + j;
const STORAGE_COLS = [2, 3, 5, 6, 8, 9, 11, 12];
const STORAGE_ROWS = [1, 2, 3, 5, 6, 7, 9, 10, 11];
export const CHARGER_ROWS = [2, 4, 6, 8, 10];
export const PRESENT = { i: 18, j: 6 };
export const LANE_ENTRY = { i: 14, j: 6 };
export const FIELD = { minX: cxw(0) - GRID.C / 2, maxX: cxw(GRID.NX - 1) + GRID.C / 2, minZ: czw(0) - GRID.C / 2, maxZ: czw(GRID.NZ - 1) + GRID.C / 2 };

export function cellType(i, j) {
  if (i < 0 || j < 0 || i >= GRID.NX || j >= GRID.NZ) return null;
  if (i === 0) return CHARGER_ROWS.includes(j) ? 'charger' : 'wall';
  if (i >= 14) return j === 6 ? (i === 18 ? 'present' : 'queue') : 'exit';
  if (STORAGE_COLS.includes(i) && STORAGE_ROWS.includes(j)) return 'storage';
  return 'aisle';
}

// ---------------- Pod-Maße (lokal, Mitte unten = 0) ----------------
export const POD = { W: 0.98, LEG: 0.32, ROW0: 0.4, ROWH: 0.38, ROWS: 5, COLS: 3, COLW: 0.31, DEPTH: 0.465, TOP: 2.32, LIFT: 0.06 };
export const rowY = r => POD.ROW0 + r * POD.ROWH;
export const colX = (face, c) => (face === 0 ? (c - 1) : (1 - c)) * POD.COLW;   // c = 0 links aus Sicht des Betrachters
export const ROW_LABEL = r => 'EDCBA'[r];                                       // A = oben, E = unten
export const binLabel = (r, c) => ROW_LABEL(r) + (c + 1);

function quad(a, b, c, d, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]], 2));
  g.computeVertexNormals();
  return g;
}

/** Stofffach (Front = +Z, Rückseite bei z = 0, Boden bei y = 0) */
export function fabricBinGeometry() {
  const w = POD.COLW - 0.016, d = POD.DEPTH - 0.012, h = POD.ROWH - 0.05, hf = h * 0.22;
  const x0 = -w / 2, x1 = w / 2;
  const parts = [
    quad([x0, 0.006, d], [x1, 0.006, d], [x1, 0.006, 0.01], [x0, 0.006, 0.01]),                    // Boden
    quad([x0, 0, 0.012], [x1, 0, 0.012], [x1, h, 0.012], [x0, h, 0.012]),                          // Rückwand
    quad([x0, 0, d], [x0, 0, 0.01], [x0, h, 0.01], [x0, hf, d], [[1, 0], [0, 0], [0, 1], [1, 0.22]]), // Seite links
    quad([x1, 0, 0.01], [x1, 0, d], [x1, hf, d], [x1, h, 0.01], [[0, 0], [1, 0], [1, 0.22], [0, 1]]), // Seite rechts
    quad([x0, 0, d], [x1, 0, d], [x1, hf, d], [x0, hf, d], [[0, 0], [1, 0], [1, 0.22], [0, 0.22]]), // Frontlippe
  ];
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return g;
}

export function podFrameGeometry() {
  const W = POD.W, h = POD.W / 2 - 0.02;
  const parts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(boxGeo(0.05, POD.LEG, 0.05, sx * 0.44, POD.LEG / 2, sz * 0.44));
    parts.push(boxGeo(0.034, POD.TOP - POD.LEG, 0.034, sx * h, (POD.LEG + POD.TOP) / 2, sz * h));
  }
  parts.push(boxGeo(W, 0.04, W, 0, POD.LEG + 0.02, 0));
  for (let r = 0; r <= POD.ROWS; r++) {
    const y = r === POD.ROWS ? POD.TOP - 0.015 : rowY(r) - 0.012;
    parts.push(boxGeo(W, 0.024, 0.03, 0, y, h), boxGeo(W, 0.024, 0.03, 0, y, -h));
    parts.push(boxGeo(0.03, 0.024, W, h, y, 0), boxGeo(0.03, 0.024, W, -h, y, 0));
  }
  parts.push(boxGeo(W, 0.03, W, 0, POD.TOP, 0));
  // Stoff-Seitenwände (geschlossen)
  const g = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
  parts.forEach(p => p.dispose());
  return g;
}

export function podSideGeometry() {
  // geschlossene Seitenflächen (±X) aus Stoff
  const y0 = POD.ROW0 - 0.02, y1 = POD.TOP - 0.02, z = POD.W / 2 - 0.03, x = POD.W / 2 - 0.022;
  const parts = [
    quad([x, y0, z], [x, y0, -z], [x, y1, -z], [x, y1, z], [[0, 0], [1, 0], [1, 2.5], [0, 2.5]]),
    quad([-x, y0, -z], [-x, y0, z], [-x, y1, z], [-x, y1, -z], [[0, 0], [1, 0], [1, 2.5], [0, 2.5]]),
  ];
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return g;
}

// ---------------- dynamischer Instanz-Pool mit "Besitzern" (Pods) ----------------
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
class DynPool {
  constructor(geometry, material, cap, { uvAttr = false, colors = false } = {}) {
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.locals = [];
    this.owner = [];
    this.hidden = new Uint8Array(cap);
    if (uvAttr) { this.uv = new Float32Array(cap * 4); this.uvAttr = new THREE.InstancedBufferAttribute(this.uv, 4); geometry.setAttribute('instUV', this.uvAttr); }
    if (colors) { this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); }
  }
  add(owner, local, uv = null, color = null) {
    const i = this.mesh.count++;
    this.locals[i] = local.clone();
    this.owner[i] = owner;
    if (uv) this.uv.set([uv.u, uv.v, uv.w, uv.h], i * 4);
    if (color) this.mesh.setColorAt(i, color);
    this.mesh.setMatrixAt(i, _m.multiplyMatrices(owner.matrix, local));
    return i;
  }
  setHidden(i, h) {
    this.hidden[i] = h ? 1 : 0;
    this.mesh.setMatrixAt(i, h ? _zero : _m.multiplyMatrices(this.owner[i].matrix, this.locals[i]));
    this._range(i, 1);
  }
  updateRange(start, count) {
    for (let i = start; i < start + count; i++) {
      this.mesh.setMatrixAt(i, this.hidden[i] ? _zero : _m.multiplyMatrices(this.owner[i].matrix, this.locals[i]));
    }
    this._range(start, count);
  }
  _range(start, count) {
    const a = this.mesh.instanceMatrix;
    a.addUpdateRange(start * 16, count * 16);
    a.needsUpdate = true;
  }
  finish() { this.mesh.instanceMatrix.needsUpdate = true; if (this.uvAttr) this.uvAttr.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
}

// ---------------- Roboter-Darstellung (2 Detailstufen) ----------------
function instancedParts(template, cap, group) {
  const parts = [];
  template.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
  template.traverse(o => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, cap);
    im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    parts.push({ im, local: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
    group.add(im);
  });
  return parts;
}
class RobotRenderer {
  /** hi = detailliertes NVIDIA-Modell (nah), lo = einfaches Modell (fern) – beide Front +Z, gleiche Maße */
  constructor(hiTpl, loTpl, cap, ledMat) {
    this.group = new THREE.Group();
    this.hi = instancedParts(hiTpl, cap, this.group);
    this.lo = loTpl ? instancedParts(loTpl, cap, this.group) : this.hi;
    const size = new THREE.Box3().setFromObject(hiTpl).getSize(new THREE.Vector3());
    this.height = size.y;
    // LED-Leisten (Status) vorne und seitlich
    const y = Math.max(0.05, size.y * 0.55);
    const ledGeo = mergeGeometries([boxGeo(size.x * 0.5, 0.02, 0.02, 0, y, size.z / 2 + 0.004), boxGeo(size.x * 0.5, 0.02, 0.02, 0, y, -size.z / 2 - 0.004), boxGeo(0.02, 0.02, size.z * 0.45, size.x / 2 + 0.004, y, 0), boxGeo(0.02, 0.02, size.z * 0.45, -size.x / 2 - 0.004, y, 0)]);
    this.led = new THREE.InstancedMesh(ledGeo, ledMat, cap);
    this.led.frustumCulled = false;
    this.led.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.led.count = 0;
    this.group.add(this.led);
  }
  begin() { this.nHi = 0; this.nLo = 0; this.nLed = 0; }
  push(m, color, near) {
    const parts = near || this.lo === this.hi ? this.hi : this.lo;
    const i = parts === this.hi ? this.nHi++ : this.nLo++;
    for (const p of parts) p.im.setMatrixAt(i, _m.multiplyMatrices(m, p.local));
    this.led.setMatrixAt(this.nLed, m);
    this.led.setColorAt(this.nLed++, color);
  }
  end() {
    for (const p of this.hi) { p.im.count = this.nHi; p.im.instanceMatrix.needsUpdate = true; }
    if (this.lo !== this.hi) for (const p of this.lo) { p.im.count = this.nLo; p.im.instanceMatrix.needsUpdate = true; }
    this.led.count = this.nLed;
    this.led.instanceMatrix.needsUpdate = true;
    this.led.instanceColor.needsUpdate = true;
  }
}

/** Ersatz-Roboter, falls das NVIDIA-Modell fehlt */
export function fallbackRobot() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(mergeGeometries([boxGeo(0.76, 0.2, 0.76, 0, 0.12, 0), boxGeo(0.7, 0.04, 0.7, 0, 0.24, 0)]), new THREE.MeshStandardMaterial({ color: 0x9aa3ae, roughness: 0.45, metalness: 0.3 }));
  const bumper = new THREE.Mesh(boxGeo(0.78, 0.05, 0.78, 0, 0.045, 0), new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7 }));
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.025, 32).translate(0, 0.27, 0), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.4, metalness: 0.6 }));
  g.add(body, bumper, plate);
  return g;
}

// ---------------- Flotte ----------------
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Fleet {
  /**
   * opts: robotTemplate (Object3D, Front = +Z, Boden = 0), chargerCount, podCount, products, atlasTex (Produktatlas),
   *       podLabelUV(no) → uv, fabricMat, frameMat, sideMat, itemMat, seed
   */
  constructor(ctx, opts) {
    this.ctx = ctx;
    this.rnd = RNG(opts.seed || 2024);
    this.res = new Map();          // reservierte Zellen → Roboter
    this.podAt = new Map();        // Lagerzelle → Pod
    this.targeted = new Set();     // Zielzellen, die gerade angefahren werden
    this.pending = [];             // wartende Pod-Besuche
    this.estop = false;
    this.onPresent = null;
    this.onRelease = null;
    this.maxStationBound = 5;
    this.group = new THREE.Group(); this.group.name = 'fleet';
    this.presented = null;
    this._bgT = 4;
    this.stats = { distance: 0 };

    // Pods
    const storage = [];
    for (let i = 0; i < GRID.NX; i++) for (let j = 0; j < GRID.NZ; j++) if (cellType(i, j) === 'storage') storage.push({ i, j });
    this.storageCells = storage;
    const shuffled = storage.slice().sort(() => this.rnd() - 0.5);
    const NP = Math.min(opts.podCount || 40, storage.length);
    this.pods = [];
    const frameGeo = podFrameGeometry(), binGeo = fabricBinGeometry(), sideGeo = podSideGeometry();
    ctx.track(frameGeo); ctx.track(binGeo); ctx.track(sideGeo);
    const itemGeo = opts.itemGeo;
    this.frames = new DynPool(frameGeo, opts.frameMat, NP);
    this.sides = new DynPool(sideGeo, opts.sideMat, NP);
    this.bins = new DynPool(binGeo, opts.fabricMat, NP * 30, { colors: true });
    this.items = new DynPool(itemGeo, opts.itemMat, NP * 30 * 4, { uvAttr: true });
    this.labels = new DynPool(opts.labelGeo, opts.labelMat, NP * 2, { uvAttr: true });
    for (const p of [this.frames, this.sides, this.bins, this.items, this.labels]) this.group.add(p.mesh);
    this.labels.mesh.castShadow = false;
    const products = opts.products;
    const binColA = new THREE.Color(0xf2b705), binColB = new THREE.Color(0xe7a800);
    for (let k = 0; k < NP; k++) {
      const cell = shuffled[k];
      const pod = {
        k, no: 101 + k * 3 + (k % 2), cell, x: cxw(cell.i), z: czw(cell.j), y: 0, yaw: this.rnd() < 0.5 ? Math.PI / 2 : -Math.PI / 2,
        matrix: new THREE.Matrix4(), carriedBy: null, reservedBy: null, bins: [],
      };
      this._podMatrix(pod);
      this.podAt.set(KEY(cell.i, cell.j), pod);
      this.frames.add(pod, new THREE.Matrix4());
      this.sides.add(pod, new THREE.Matrix4());
      pod.binStart = this.bins.mesh.count;
      pod.itemStart = this.items.mesh.count;
      for (let face = 0; face < 2; face++) {
        pod.bins[face] = [];
        for (let r = 0; r < POD.ROWS; r++) {
          pod.bins[face][r] = [];
          for (let c = 0; c < POD.COLS; c++) {
            const local = new THREE.Matrix4().makeRotationY(face === 0 ? 0 : Math.PI).setPosition(colX(face, c), rowY(r), 0);
            this.bins.add(pod, local, null, (r + c + face) % 2 ? binColA : binColB);
            const sku = products[Math.floor(this.rnd() * products.length)];
            const stock = 1 + Math.floor(this.rnd() * 3);
            pod.bins[face][r][c] = { sku, stock, units: [], local };
          }
        }
      }
      // Artikel in die Fächer (nach Fächern, damit Pod-Bereiche zusammenhängen)
      for (let face = 0; face < 2; face++) for (let r = 0; r < POD.ROWS; r++) for (let c = 0; c < POD.COLS; c++) this._fillBin(pod, face, r, c, opts);
      pod.itemCount = this.items.mesh.count - pod.itemStart;
      pod.labelStart = this.labels.mesh.count;
      for (let face = 0; face < 2; face++) {
        const lm = new THREE.Matrix4().makeRotationY(face === 0 ? 0 : Math.PI).setPosition(0, POD.TOP - 0.11, 0).multiply(new THREE.Matrix4().makeTranslation(0, 0, POD.W / 2 + 0.004));
        this.labels.add(pod, lm, opts.podLabelUV(pod.no));
      }
      this.pods.push(pod);
    }
    for (const p of [this.frames, this.sides, this.bins, this.items, this.labels]) p.finish();

    // Ladestationen
    this.chargers = CHARGER_ROWS.map(j => ({ i: 0, j }));

    // Roboter
    const tpl = opts.robotTemplate;
    const nR = opts.robotCount || 9;
    this.ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: true });
    ctx.track(this.ledMat);
    this.renderer = new RobotRenderer(tpl, opts.robotTemplateLow || null, nR, this.ledMat);
    this.nearCount = opts.nearRobots ?? 4;
    this.nearDist = opts.nearDist ?? 12;
    this.group.add(this.renderer.group);
    this.robots = [];
    const podCellsWithRobot = this.pods.slice().sort(() => this.rnd() - 0.5);
    for (let n = 0; n < nR; n++) {
      let cell, battery, state;
      if (n < 3) { cell = this.chargers[n * 2]; battery = 0.35 + this.rnd() * 0.25; state = 'charging'; }
      else { cell = podCellsWithRobot[n].cell; battery = 0.6 + this.rnd() * 0.35; state = 'idle'; }
      const r = new Robot(this, n, cell, battery, state);
      if (state === 'charging') r.jobs.push({ t: 'charge' });
      this.robots.push(r);
    }
    ctx.root.add(this.group);
  }

  _fillBin(pod, face, r, c, opts) {
    const bin = pod.bins[face][r][c];
    const p = bin.sku;
    let [w, h, d] = p.size;
    // passt das Produkt ins Fach? sonst verkleinert darstellen
    const maxH = POD.ROWH - 0.07;
    const s = Math.min(1, maxH / h, (POD.COLW - 0.05) / w);
    w *= s; h *= s; d *= s;
    const cols = (2 * w + 0.02 <= POD.COLW - 0.03 && bin.stock > 1) ? 2 : 1;
    for (let u = 0; u < Math.min(bin.stock, 4); u++) {
      const col = u % cols, deep = Math.floor(u / cols);
      const lx = cols === 2 ? (col - 0.5) * (w + 0.012) : 0;
      const lz = POD.DEPTH - 0.05 - d / 2 - deep * (d + 0.015);
      if (lz - d / 2 < 0.02) break;
      const local = new THREE.Matrix4().compose(new THREE.Vector3(lx, h / 2 + 0.008, lz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.04, (u % 3 - 1) * 0.06, 0)), new THREE.Vector3(w, h, d));
      const full = bin.local.clone().multiply(local);
      bin.units.push(this.items.add(pod, full, opts.productUV(p)));
    }
  }

  _podMatrix(pod) {
    pod.matrix.makeRotationY(pod.yaw).setPosition(pod.x, pod.y, pod.z);
  }

  _updatePod(pod) {
    this._podMatrix(pod);
    this.frames.updateRange(pod.k, 1);
    this.sides.updateRange(pod.k, 1);
    this.bins.updateRange(pod.binStart, 30);
    this.items.updateRange(pod.itemStart, pod.itemCount);
    this.labels.updateRange(pod.labelStart, 2);
  }

  /** eine sichtbare Einheit aus einem Fach entfernen */
  takeUnit(pod, face, r, c) {
    const bin = pod.bins[face][r][c];
    if (bin.stock <= 0) return false;
    bin.stock--;
    const vis = bin.units.filter(i => !this.items.hidden[i]);
    if (vis.length > bin.stock) this.items.setHidden(vis[vis.length - 1], true);
    return true;
  }
  /** Fach als leer darstellen (Bestandsdifferenz) */
  emptyBin(pod, face, r, c) {
    const bin = pod.bins[face][r][c];
    bin.stock = 0;
    bin.units.forEach(i => this.items.setHidden(i, true));
  }

  reserve(cell, robot) {
    const k = KEY(cell.i, cell.j), cur = this.res.get(k);
    if (cur && cur !== robot) return false;
    this.res.set(k, robot);
    return true;
  }
  unreserve(cell, robot) {
    const k = KEY(cell.i, cell.j);
    if (this.res.get(k) === robot) this.res.delete(k);
  }
  reservedBy(cell) { return this.res.get(KEY(cell.i, cell.j)) || null; }

  passable(i, j, robot, start, goal, blocked) {
    if ((i === goal.i && j === goal.j) || (i === start.i && j === start.j)) return true;
    if (blocked && blocked.has(KEY(i, j))) return false;
    const t = cellType(i, j);
    if (t === 'aisle') return true;
    if (t === 'queue' || t === 'present') return robot.role === 'station';
    if (t === 'exit') return robot.role === 'leave';
    return false;
  }

  /** A* mit Abbiege-Strafe (Roboter fahren lieber geradeaus) */
  findPath(start, goal, robot, blocked = null) {
    if (start.i === goal.i && start.j === goal.j) return [];
    const open = [{ i: start.i, j: start.j, d: -1, g: 0, f: 0, prev: null }];
    const best = new Map();
    best.set(KEY(start.i, start.j) * 5 + 4, 0);
    let iter = 0;
    while (open.length && iter++ < 4000) {
      let bi = 0;
      for (let n = 1; n < open.length; n++) if (open[n].f < open[bi].f) bi = n;
      const cur = open.splice(bi, 1)[0];
      if (cur.i === goal.i && cur.j === goal.j) {
        const path = [];
        let n = cur;
        while (n.prev) { path.unshift({ i: n.i, j: n.j }); n = n.prev; }
        return path;
      }
      for (let d = 0; d < 4; d++) {
        const ni = cur.i + DIRS[d][0], nj = cur.j + DIRS[d][1];
        if (!this.passable(ni, nj, robot, start, goal, blocked)) continue;
        const g = cur.g + 1 + (cur.d >= 0 && cur.d !== d ? 0.6 : 0);
        const kk = KEY(ni, nj) * 5 + d;
        if (best.has(kk) && best.get(kk) <= g) continue;
        best.set(kk, g);
        open.push({ i: ni, j: nj, d, g, f: g + Math.abs(goal.i - ni) + Math.abs(goal.j - nj), prev: cur });
      }
    }
    return null;
  }

  /** Besuch (Pod zur Station) anfordern */
  enqueue(visit, front = false) {
    visit.state = 'pending';
    if (front) this.pending.unshift(visit); else this.pending.push(visit);
  }

  release(visit) {
    const r = visit.robot;
    if (r) r.released = true;
    if (this.presented === visit) this.presented = null;
  }

  setEStop(on) { this.estop = on; }

  robotUnder(pod) {
    return this.robots.find(r => !r.pod && r.cell.i === pod.cell.i && r.cell.j === pod.cell.j) || null;
  }

  /** Startaufstellung: einen freien Roboter direkt unter einen Pod stellen (schneller Schichtbeginn) */
  parkUnder(pod, avoid = new Set()) {
    if (this.robotUnder(pod)) return;
    const r = this.robots.find(x => !x.jobs.length && !x.pod && x.cell.i !== 0 && !avoid.has(x));
    if (!r) return;
    this.unreserve(r.cell, r);
    r.cell = { ...pod.cell };
    r.x = cxw(pod.cell.i); r.z = czw(pod.cell.j);
    this.reserve(r.cell, r);
    avoid.add(r);
  }

  _dispatch() {
    if (this.estop) return;
    let bound = this.robots.filter(r => r.stationBound).length;
    while (this.pending.length && bound < this.maxStationBound) {
      const v = this.pending[0];
      const pod = v.pod;
      if (pod.carriedBy || (pod.reservedBy && pod.reservedBy.visit !== v)) {
        // Pod ist gerade unterwegs (z. B. Umlagerung) – nächsten Besuch vorziehen, falls möglich
        const alt = this.pending.findIndex(x => !x.pod.carriedBy && !x.pod.reservedBy);
        if (alt > 0) { this.pending.unshift(this.pending.splice(alt, 1)[0]); continue; }
        break;
      }
      let r = this.robotUnder(pod);
      if (r && (r.jobs.length || r.battery < 0.2)) r = null;
      if (!r) r = this._nearestFree(pod.cell);
      if (!r) break;
      this.pending.shift();
      this._assign(r, v);
      bound++;
    }
  }

  _nearestFree(cell) {
    let best = null, bd = 1e9;
    for (const r of this.robots) {
      const free = !r.jobs.length || (r.jobs.length === 1 && r.jobs[0].t === 'charge' && r.battery > 0.55);
      if (!free || r.pod || r.battery < 0.25) continue;
      const d = Math.abs(r.cell.i - cell.i) + Math.abs(r.cell.j - cell.j);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  _assign(r, visit) {
    r.jobs = [];
    r.stationBound = true;
    r.visit = visit;
    r.released = false;
    visit.robot = r;
    visit.state = 'assigned';
    visit.pod.reservedBy = r;
    r.jobs.push({ t: 'goto', cell: visit.pod.cell, role: 'normal' }, { t: 'lift' }, { t: 'goto', cell: LANE_ENTRY, role: 'station' },
      { t: 'goto', cell: PRESENT, role: 'station' }, { t: 'present' }, { t: 'store' });
  }

  /** freie Lagerzelle nahe der Station (dynamische Lagerplatzvergabe: Schnelldreher nach vorne) */
  _freeStorageNearStation(exclude) {
    let best = null, bd = 1e9;
    for (const c of this.storageCells) {
      const k = KEY(c.i, c.j);
      if (this.podAt.has(k) || this.targeted.has(k) || this.res.has(k) || (exclude && exclude.has(k))) continue;
      const d = Math.abs(c.i - PRESENT.i) * 1.0 + Math.abs(c.j - PRESENT.j) * 1.2 + this.rnd() * 2.5;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  _freeCharger() {
    return this.chargers.find(c => !this.res.has(KEY(c.i, c.j)) && !this.targeted.has(KEY(c.i, c.j))) || null;
  }

  _background(dt) {
    this._bgT -= dt;
    if (this._bgT > 0 || this.estop) return;
    this._bgT = 5 + this.rnd() * 5;
    const busyBg = this.robots.filter(r => r.bg).length;
    if (busyBg >= 2) return;
    const needed = new Set(this.pending.map(v => v.pod));
    if (this.futurePods) for (const p of this.futurePods) needed.add(p);
    const cands = this.robots.filter(r => !r.jobs.length && !r.pod && r.battery > 0.45 && this.podAt.get(KEY(r.cell.i, r.cell.j)));
    const r = cands[Math.floor(this.rnd() * cands.length)];
    if (!r) return;
    const pod = this.podAt.get(KEY(r.cell.i, r.cell.j));
    if (needed.has(pod) || pod.reservedBy) return;
    // irgendeine freie Lagerzelle (nicht direkt vorne – die ist für Schnelldreher)
    const free = this.storageCells.filter(c => !this.podAt.has(KEY(c.i, c.j)) && !this.targeted.has(KEY(c.i, c.j)) && !this.res.has(KEY(c.i, c.j)));
    const target = free[Math.floor(this.rnd() * free.length)];
    if (!target) return;
    r.bg = true;
    pod.reservedBy = r;
    this.targeted.add(KEY(target.i, target.j));
    r.jobs.push({ t: 'lift' }, { t: 'goto', cell: target, role: 'normal' }, { t: 'lower', cell: target });
  }

  update(dt) {
    this._dispatch();
    this._background(dt);
    for (const r of this.robots) r.update(dt);
    // Darstellung mit Detailstufen: nur die nächsten Roboter mit dem aufwendigen Modell
    const cam = this.ctx.engine.headPosition(_cam);
    for (const r of this.robots) r._d = (r.x - cam.x) ** 2 + (r.z - cam.z) ** 2;
    const sorted = this.robots.slice().sort((a, b) => a._d - b._d);
    const near = new Set(sorted.slice(0, this.nearCount).filter(r => r._d < this.nearDist * this.nearDist));
    this.renderer.begin();
    for (const r of this.robots) r.render(near.has(r));
    this.renderer.end();
  }

  counts() {
    const c = { total: this.robots.length, active: 0, charging: 0, idle: 0, battery: 0 };
    for (const r of this.robots) {
      c.battery += r.battery;
      if (r.jobs.length && r.jobs[0].t === 'charge') c.charging++;
      else if (r.jobs.length) c.active++;
      else c.idle++;
    }
    c.battery /= this.robots.length;
    return c;
  }

  /** Leitstand-Karte zeichnen */
  drawMap(g, x, y, w, h) {
    const cw = w / GRID.NX, ch = h / GRID.NZ;
    g.fillStyle = '#0a1018'; g.fillRect(x, y, w, h);
    for (let i = 0; i < GRID.NX; i++) for (let j = 0; j < GRID.NZ; j++) {
      const t = cellType(i, j);
      g.fillStyle = t === 'storage' ? '#101a26' : t === 'charger' ? '#0f2b3a' : t === 'queue' ? '#1b2a1b' : t === 'present' ? '#14532d' : t === 'exit' ? '#141a22' : t === 'wall' ? '#070a0e' : '#0c131c';
      g.fillRect(x + i * cw + 1, y + j * ch + 1, cw - 2, ch - 2);
    }
    for (const p of this.pods) {
      const px = x + (p.x - FIELD.minX) / (FIELD.maxX - FIELD.minX) * w, pz = y + (p.z - FIELD.minZ) / (FIELD.maxZ - FIELD.minZ) * h;
      g.fillStyle = p.carriedBy ? '#facc15' : '#a16207';
      g.fillRect(px - cw * 0.32, pz - ch * 0.32, cw * 0.64, ch * 0.64);
    }
    for (const r of this.robots) {
      const px = x + (r.x - FIELD.minX) / (FIELD.maxX - FIELD.minX) * w, pz = y + (r.z - FIELD.minZ) / (FIELD.maxZ - FIELD.minZ) * h;
      g.fillStyle = '#' + r.ledColor.getHexString();
      g.beginPath(); g.arc(px, pz, Math.min(cw, ch) * 0.26, 0, 7); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke();
      if (r.path.length && r.v > 0.02) {
        g.strokeStyle = 'rgba(34,211,238,0.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(px, pz);
        for (const c of r.path) g.lineTo(x + (cxw(c.i) - FIELD.minX) / (FIELD.maxX - FIELD.minX) * w, y + (czw(c.j) - FIELD.minZ) / (FIELD.maxZ - FIELD.minZ) * h);
        g.stroke();
      }
    }
  }
}

// ---------------- Roboter ----------------
const _rm = new THREE.Matrix4();
const _cam = new THREE.Vector3();
const COL = {
  idle: new THREE.Color(0.12, 0.35, 0.9), drive: new THREE.Color(0.1, 0.9, 1.0), carry: new THREE.Color(0.2, 1.0, 0.45),
  wait: new THREE.Color(1.0, 0.7, 0.1), charge: new THREE.Color(0.25, 0.45, 1.0), stop: new THREE.Color(1.0, 0.08, 0.05),
};

class Robot {
  constructor(fleet, idx, cell, battery, state) {
    this.f = fleet; this.idx = idx;
    this.name = 'R' + String(idx + 1).padStart(2, '0');
    this.cell = { ...cell };
    this.x = cxw(cell.i); this.z = czw(cell.j);
    this.yaw = cell.i === 0 ? -Math.PI / 2 : (fleet.rnd() < 0.5 ? 0 : Math.PI / 2);
    this.v = 0; this.path = []; this.role = 'normal';
    this.jobs = []; this.pod = null; this.lift = 0; this.battery = battery;
    this.waitT = 0; this.replanAt = 0.9 + fleet.rnd() * 1.2; this.t = 0;
    this.stationBound = false; this.visit = null; this.released = false; this.bg = false;
    this.ledColor = COL.idle.clone();
    this.audioObj = new THREE.Object3D();
    this.audioObj.position.set(this.x, 0.2, this.z);
    fleet.group.add(this.audioObj);
    fleet.reserve(this.cell, this);
  }

  get speedMax() { return this.pod ? 1.6 : 2.0; }

  update(dt) {
    this.t += dt;
    const f = this.f;
    const job = this.jobs[0];
    let status = 'idle';
    if (f.estop) {
      this.v = Math.max(0, this.v - 4 * dt);
      this._advance(dt, true);
      this.state = 'stop';
      return;
    }
    if (!job) {
      // nach getaner Arbeit: Akku prüfen
      if (this.battery < 0.3 && !this.pod) {
        const ch = f._freeCharger();
        if (ch) { f.targeted.add(KEY(ch.i, ch.j)); this.jobs.push({ t: 'goto', cell: ch, role: 'normal', charger: true }, { t: 'charge' }); }
      }
      this.state = 'idle';
      this.battery = Math.max(0, this.battery - dt * 0.0002);
      return;
    }
    switch (job.t) {
      case 'goto': {
        if (job.retry > 0) { job.retry -= dt; status = 'wait'; break; }
        if (!job.started) {
          job.started = true;
          this.role = job.role;
          const p = f.findPath(this.cell, job.cell, this);
          if (p === null) { job.started = false; job.retry = 0.6; status = 'wait'; break; }
          this.path = p;
        }
        const arrived = this._drive(dt);
        status = this.waitT > 0.2 ? 'wait' : (this.pod ? 'carry' : 'drive');
        if (arrived && this.cell.i === job.cell.i && this.cell.j === job.cell.j) {
          if (job.charger) f.targeted.delete(KEY(job.cell.i, job.cell.j));
          this.jobs.shift();
        } else if (arrived) {
          job.started = false;   // Pfad verloren → neu planen
        }
        break;
      }
      case 'lift': {
        if (!this.pod) {
          const pod = f.podAt.get(KEY(this.cell.i, this.cell.j));
          if (!pod) { this.jobs.shift(); break; }
          this.pod = pod; pod.carriedBy = this;
          f.podAt.delete(KEY(this.cell.i, this.cell.j));
        }
        this.lift = Math.min(1, this.lift + dt / 0.7);
        this._syncPod();
        status = 'carry';
        if (this.lift >= 1) this.jobs.shift();
        break;
      }
      case 'lower': {
        this.lift = Math.max(0, this.lift - dt / 0.7);
        this._syncPod();
        status = 'carry';
        if (this.lift <= 0) {
          const pod = this.pod;
          pod.carriedBy = null; pod.reservedBy = null;
          pod.cell = { ...this.cell };
          f.podAt.set(KEY(this.cell.i, this.cell.j), pod);
          f.targeted.delete(KEY(this.cell.i, this.cell.j));
          this.pod = null;
          this.bg = false;
          this.jobs.shift();
        }
        break;
      }
      case 'present': {
        const pod = this.pod;
        if (!job.started) { job.started = true; job.targetYaw = this.visit.face === 0 ? Math.PI / 2 : -Math.PI / 2; this.role = 'station'; }
        const dy = wrap(job.targetYaw - pod.yaw);
        if (Math.abs(dy) > 0.005) {
          pod.yaw += Math.sign(dy) * Math.min(Math.abs(dy), dt * 2.4);
          this._syncPod();
          status = 'carry';
          break;
        }
        if (!job.ready) {
          job.ready = true;
          pod.yaw = job.targetYaw; this._syncPod();
          this.visit.state = 'presented';
          f.presented = this.visit;
          if (f.onPresent) f.onPresent(this.visit);
        }
        status = 'wait';
        if (this.released) {
          this.released = false;
          this.stationBound = false;
          this.jobs.shift();
          if (f.onRelease) f.onRelease(this.visit);
        }
        break;
      }
      case 'store': {
        const target = f._freeStorageNearStation();
        this.jobs.shift();
        if (!target) { this.jobs.unshift({ t: 'store', wait: 1 }); break; }
        f.targeted.add(KEY(target.i, target.j));
        this.visit = null;
        this.jobs.unshift({ t: 'goto', cell: target, role: 'leave' }, { t: 'lower', cell: target });
        break;
      }
      case 'charge': {
        status = 'charge';
        this.battery = Math.min(1, this.battery + dt * 0.035);
        if (this.battery >= 0.96) { this.jobs.shift(); }
        break;
      }
      default: this.jobs.shift();
    }
    this.state = status;
  }

  /** fährt entlang des Pfads; gibt true zurück, wenn der Pfad zu Ende ist */
  _drive(dt) {
    const f = this.f;
    if (!this.path.length) { this.v = 0; return true; }
    const next = this.path[0];
    if (!f.reserve(next, this)) {
      this.v = Math.max(0, this.v - 5 * dt);
      this.waitT += dt;
      if (this.waitT > this.replanAt) {
        this.waitT = 0;
        this.replanAt = 0.8 + f.rnd() * 1.4;
        // um blockierte Zellen herum neu planen
        const blocked = new Set();
        for (const [k, rr] of f.res) if (rr !== this) blocked.add(k);
        const goal = this.path[this.path.length - 1];
        const np = f.findPath(this.cell, goal, this, blocked);
        if (np && np.length) this.path = np;
      }
      return false;
    }
    this.waitT = 0;
    const tx = cxw(next.i), tz = czw(next.j);
    const dx = tx - this.x, dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(dx, dz);
    const dy = wrap(targetYaw - this.yaw);
    if (Math.abs(dy) > 0.01 && dist > 0.02) {
      // nur im Stand drehen (wie echte Antriebseinheiten)
      if (this.v > 0.04) { this.v = Math.max(0, this.v - 4 * dt); return false; }
      this.yaw += Math.sign(dy) * Math.min(Math.abs(dy), dt * 3.2);
      this._syncPod();
      return false;
    }
    // Länge der geraden Strecke → Bremsweg
    let run = dist;
    const ddx = Math.sign(Math.round(dx * 100)), ddz = Math.sign(Math.round(dz * 100));
    for (let k = 1; k < this.path.length; k++) {
      const a = this.path[k - 1], b = this.path[k];
      if (b.i - a.i === ddx && b.j - a.j === ddz) run += GRID.C; else break;
    }
    const vT = Math.min(this.speedMax, Math.sqrt(2 * 1.4 * Math.max(0, run - 0.02)));
    if (this.v < vT) this.v = Math.min(vT, this.v + 1.3 * dt); else this.v = Math.max(vT, this.v - 2.0 * dt);
    const step = Math.min(Math.max(this.v, 0.05) * dt, dist);
    this.x += dist > 1e-6 ? dx / dist * step : 0;
    this.z += dist > 1e-6 ? dz / dist * step : 0;
    f.stats.distance += step;
    this.battery = Math.max(0.05, this.battery - step * 0.0025);
    if (dist - step < 0.004) {
      this.x = tx; this.z = tz;
      f.unreserve(this.cell, this);
      this.cell = { i: next.i, j: next.j };
      this.path.shift();
      if (!this.path.length) { this.v = 0; return true; }
    }
    this._syncPod();
    return false;
  }

  _advance(dt) { this._syncPod(); }

  _syncPod() {
    const pod = this.pod;
    if (!pod) return;
    pod.x = this.x; pod.z = this.z; pod.y = this.lift * POD.LIFT;
    pod.dirty = true;
  }

  render(near) {
    const f = this.f;
    const s = f.estop ? 'stop' : this.state;
    let c = COL[s] || COL.idle;
    const blink = s === 'stop' ? (Math.sin(this.t * 12) > 0 ? 1 : 0.15) : s === 'charge' ? 0.55 + 0.45 * Math.sin(this.t * 3) : 1;
    this.ledColor.copy(c).multiplyScalar(blink);
    _rm.makeRotationY(this.yaw).setPosition(this.x, 0, this.z);
    f.renderer.push(_rm, this.ledColor, near);
    this.audioObj.position.set(this.x, 0.2, this.z);
    if (this.pod && this.pod.dirty) { this.pod.dirty = false; f._updatePod(this.pod); }
  }
}
