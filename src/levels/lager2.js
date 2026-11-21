// LAGER 02 – Großhandel Nordstern
// Palettenregallager · Kommissionierung aus der Bodenebene · Pick-by-Scan (MDE) · chaotische Lagerhaltung · Staplerverkehr
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildHall, setupLighting, captureEnvironment, bakeFloorAO, floorLines, boxGeo, mergeToMesh } from '../core/env.js';
import { Atlas, AtlasInstances, ModelInstances, atlasInstancedMaterial, signMesh, outsideTexture } from '../core/builders.js';
import { locationLabel, makeCanvas, signCanvas, FONT, MONO, drawCode128 } from '../core/canvas.js';
import { Interaction, roundRect } from '../core/interaction.js';
import { fmtTime, fmtNum, loadResults } from '../sim/mission.js';
import { groundCenter } from '../core/assets.js';
import { RACK, buildRacks, rackLabels, slotZ, levelY } from './lager2/rack.js';
import { ARTICLES, byId, cartonCanvas, blockCanvas, cartonGeometry, blockGeometry, stackLayout, palletGeometry, mhdText } from './lager2/goods.js';
import { Vehicle } from './lager2/vehicle.js';
import { drawMDE } from './lager2/mde.js';

const RNG = s => () => (s = (s * 16807) % 2147483647) / 2147483647;

// ------------------------------------------------------------------ Layout
const HALL = { w: 30, d: 26, h: 9 };
const Z_FRONT = 3.55;                      // Stirnseite der Regale (Hauptgang davor)
const ROW_LEN = RACK.BAYS * RACK.BAY_W;    // 16,2 m
const ROWS = [
  { x: -14.25, face: 1, gang: '01', odd: true },
  { x: -10.05, face: -1, gang: '01', odd: false },
  { x: -8.9, face: 1, gang: '02', odd: true },
  { x: -4.7, face: -1, gang: '02', odd: false },
  { x: -3.55, face: 1, gang: '03', odd: true },
  { x: 0.65, face: -1, gang: '03', odd: false },
];
const AISLES = [{ gang: '01', x: -12.15 }, { gang: '02', x: -6.8 }, { gang: '03', x: -1.45 }];
const WALK = { minX: -14.7, maxX: 14.7, minZ: 4.0, maxZ: 5.1 };
const DOORS = [{ x: 4.0, wa: 'WA 1' }, { x: 8.0, wa: 'WA 2', open: true }, { x: 12.0, wa: 'WA 3' }];
const SPOTS = {
  mde: new THREE.Vector3(14.62, 0, 0.6),       // Ladestation an der Ostwand
  jack: new THREE.Vector3(12.35, 0, 2.5),
  desk: new THREE.Vector3(13.0, 0, -1.5),
  spawn: { x: 12.6, z: 4.5, yaw: -0.47 },
  reachPark: new THREE.Vector3(2.4, 0, 6.6),
};
const ORDER = {
  no: '30481', customer: 'Hotel am Stadtpark (Lieferung morgen 6 Uhr)', dock: 'WA 2', dockText: 'Warenausgang · Rampe 2',
  lines: [['wasser', '01-05-0', 3], ['wasch', '01-14-0', 2], ['reis', '02-03-0', 2], ['apfel', '02-08-0', 3], ['tomaten', '02-17-0', 2], ['spaghetti', '03-06-0', 2], ['spuel', '03-11-0', 2], ['kaffee', '03-20-0', 1], ['toilet', '03-04-0', 2]],
  short: '02-08-0',
};

export default {
  async build(ctx, { onProgress } = {}) {
    const { engine, mat, assets, ui, audio, player, interaction, root, input } = ctx;
    const rnd = RNG(30481);

    const modelIds = ['pallet', 'pallet_jack', 'scanner_handheld', 'forklift', 'reach_truck', 'stacker', 'pallet_load_wrapped', 'pallet_load_mixed',
      'work_table', 'monitor_office', 'lockers', 'first_aid', 'extinguisher', 'extinguisher_stand', 'trash_bin', 'guard_rail', 'sign_cone', 'label_printer', 'terminal_rugged'];
    await assets.preload(modelIds, (p, id) => onProgress && onProgress(p * 0.45, 'Modell: ' + id));

    // ---------------- Halle
    const floorMat = mat.pbr('floor_concrete_worn', { repeat: [HALL.w / 4, HALL.d / 4], ao: false, fallbackColor: 0x8c8c88, roughness: 1, metalness: 1, tag: 'l2floor' });
    const wallMat = mat.pbr('wall_panel_metal', { repeat: [1, 1], fallbackColor: 0xc9ced3, color: 0xeef1f4, metalness: 0.25, tag: 'l2wall' });
    const lowerMat = mat.pbr('wall_plaster', { repeat: [1, 1], color: 0x8a929b, fallbackColor: 0x7a828b, metalness: 0, tag: 'l2lower' });
    const ceilMat = mat.pbr('wall_panel_metal', { repeat: [HALL.w / 3, HALL.d / 3], color: 0xa4abb2, fallbackColor: 0x6a7076, metalness: 0.3, rotation: Math.PI / 2, tag: 'l2ceil' });
    const hall = buildHall(ctx, {
      ...HALL, style: 'hall', floor: floorMat, wall: wallMat, wallTile: 3, ceiling: ceilMat, wallLower: lowerMat, wallLowerH: 1.4,
      trussSpacing: 6.5, trussMat: mat.basic(0x56606b, 0.5, 0.6),
      doors: DOORS.map(d => ({ side: 's', at: d.x, w: 3.0, h: 3.6 })),
    });
    const footprints = [];

    // Tore
    for (const d of DOORS) buildDock(ctx, d, footprints);
    // Oberlichtbänder an der Nordwand (Tageslicht)
    const skyGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: outsideTexture(), emissiveIntensity: 0.95, roughness: 0.2 });
    for (const x of [-11, -3.5, 4, 11.5]) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 0.9), skyGlow);
      pane.position.set(x, 7.7, -HALL.d / 2 + 0.16);
      root.add(pane);
      const frame = mergeToMesh([boxGeo(5.6, 0.06, 0.1, x, 8.16, -HALL.d / 2 + 0.2), boxGeo(5.6, 0.06, 0.1, x, 7.24, -HALL.d / 2 + 0.2), ...[0, 1, 2, 3, 4, 5].map(i => boxGeo(0.05, 0.9, 0.08, x - 2.75 + i * 1.1, 7.7, -HALL.d / 2 + 0.2))], mat.basic(0x3b434c, 0.5, 0.5), { cast: false });
      root.add(frame);
    }

    // ---------------- Regale
    buildRacks(ctx, ROWS, Z_FRONT);
    for (const r of ROWS) {
      player.addBox(r.x - RACK.DEPTH / 2 - 0.02, Z_FRONT - ROW_LEN - 0.05, r.x + RACK.DEPTH / 2 + 0.02, Z_FRONT + 0.5, 'rack');
      footprints.push({ x: r.x, z: Z_FRONT - ROW_LEN / 2, w: RACK.DEPTH + 0.2, d: ROW_LEN, s: 0.5, blur: 0.35 });
    }
    onProgress && onProgress(0.5, 'Kartons bedrucken …');

    // ---------------- Artikel-Atlanten
    const cartonAtlas = new Atlas(ctx, { size: 2048, cellW: 384, cellH: 288 });
    const blockAtlas = new Atlas(ctx, { size: 2048, cellW: 341, cellH: 341 });
    ARTICLES.forEach((a, i) => {
      const cc = cartonCanvas(a, i);
      a.uv = cartonAtlas.add(cc);
      a.blockUV = blockAtlas.add(blockCanvas(a, cc));
    });
    const jackMatCache = new Map();      // Material je Artikel für einzelne Kartons (Atlas-Ausschnitt)
    const cartonGeo = ctx.track(cartonGeometry());
    const cartonMat = ctx.track(atlasInstancedMaterial(cartonAtlas.texture, { roughness: 0.82 }));
    const cartons = new AtlasInstances(cartonGeo, cartonMat, 2700);
    const blockGeo = ctx.track(blockGeometry());
    const blockMat = ctx.track(atlasInstancedMaterial(blockAtlas.texture, { roughness: 0.55 }));
    const blocks = new AtlasInstances(blockGeo, blockMat, 280);

    // Paletten: Bodenebene mit NVIDIA-Palette (falls vorhanden), Reserve prozedural
    const palGeo = ctx.track(palletGeometry(mergeGeometries));
    const palMat = mat.pbr('wood_planks', { repeat: [1, 1], color: 0xd9c4a0, fallbackColor: 0xb99a6a, metalness: 0, tag: 'l2pal' });
    const reservePallets = new THREE.InstancedMesh(palGeo, palMat, 300);
    reservePallets.count = 0; reservePallets.castShadow = false; reservePallets.receiveShadow = true;
    const palletTpl = assets.templates.get('pallet');
    let groundPallets;
    let palletFit = null;
    if (palletTpl) {
      // holder (Identität) → scaleG (Maße) → rotG (lange Seite entlang Z) → Modell
      const holder = new THREE.Group(), scaleG = new THREE.Group(), rotG = new THREE.Group();
      holder.add(scaleG); scaleG.add(rotG);
      rotG.add(palletTpl.clone(true));
      const s = assets.size('pallet');
      if (s.x > s.z) rotG.rotation.y = Math.PI / 2;
      holder.updateMatrixWorld(true);
      groundCenter(rotG);
      const sz = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
      scaleG.scale.set(0.8 / sz.x, 0.144 / sz.y, 1.2 / sz.z);
      holder.updateMatrixWorld(true);
      palletFit = holder;
      groundPallets = new ModelInstances(holder, 120, { cast: false });   // Paletten werfen keinen Schatten (spart den halben Schattenpass)
    }
    // Bodenpaletten doppelt: NVIDIA-Modell am PC (detailreich), prozedural in VR / niedriger Qualität (spart ~130k Dreiecke)
    const groundLQ = new THREE.InstancedMesh(palGeo, palMat, 120);
    groundLQ.count = 0; groundLQ.castShadow = false; groundLQ.receiveShadow = true;
    const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
    const addGroundPallet = (x, z) => {
      const m = new THREE.Matrix4().makeTranslation(x, 0, z);
      const lq = groundLQ.count++;
      groundLQ.setMatrixAt(lq, m);
      return { hq: groundPallets ? groundPallets.add(m) : null, lq, m };
    };
    const setGroundPalletVisible = (p, v) => {
      if (p.hq != null) groundPallets.setVisible(p.hq, v);
      groundLQ.setMatrixAt(p.lq, v ? p.m : zeroM); groundLQ.instanceMatrix.needsUpdate = true;
    };
    const updatePalletLOD = () => {
      const hq = !!groundPallets && !engine.isXR && engine.quality.key !== 'low';
      if (groundPallets) groundPallets.group.visible = hq;
      groundLQ.visible = !hq;
    };

    // ---------------- Lagerplätze
    const locs = [];             // Bodenplätze (Kommissionierplätze)
    const byCode = new Map();
    const labelItems = [];
    const allPos = [];
    for (const row of ROWS) {
      const xFront = row.x + row.face * RACK.DEPTH / 2;
      for (let p = 0; p < 12; p++) {
        const platzN = row.odd ? p * 2 + 1 : p * 2 + 2;
        const platz = String(platzN).padStart(2, '0');
        const z = slotZ(Z_FRONT, p);
        for (let L = 0; L <= 3; L++) {
          const code = `${row.gang}-${platz}-${L}`;
          const pos = { code, gang: row.gang, platz, level: L, row, p, z, x: xFront - row.face * 0.35, xFront, face: row.face };
          allPos.push(pos);
          byCode.set(code, pos);
          // Etikett: Ebene 0 und 1 an der ersten Traverse (links ▼, rechts ▲), sonst an der eigenen Traverse
          const ly = L <= 1 ? RACK.BEAMS[0] : RACK.BEAMS[L - 1];
          const lz = L === 0 ? z + row.face * 0.2 : L === 1 ? z - row.face * 0.2 : z;
          pos.label = { x: xFront, y: ly, z: lz, face: row.face };
        }
      }
    }
    // Artikel zuordnen: Auftragsplätze fest, Rest zufällig (gleicher Artikel oft an mehreren Plätzen = chaotisch)
    const fixed = new Map(ORDER.lines.map(([id, code]) => [code, id]));
    fixed.set('03-15-0', 'apfel'); fixed.set('02-12-0', 'wasser'); fixed.set('03-01-0', 'wasser'); fixed.set('01-23-0', 'toilet');
    const groundPos = allPos.filter(p => p.level === 0);
    const pool = ARTICLES.filter(a => !['wasserm'].includes(a.id) || true);
    for (const pos of groundPos) {
      const a = fixed.has(pos.code) ? byId(fixed.get(pos.code)) : pool[Math.floor(rnd() * pool.length)];
      const lay = stackLayout(a, 1.25);
      const cap = Math.min(lay.max, 30);
      let stock = Math.max(lay.per + 1, Math.round(cap * (0.45 + rnd() * 0.55)));
      if (pos.code === ORDER.short) stock = 1;
      const loc = { ...pos, a, lay, stock, systemStock: pos.code === ORDER.short ? 9 : stock, idx: [], mhd: mhdText(Math.floor(rnd() * 40)) };
      loc.pallet = addGroundPallet(loc.x, loc.z);
      for (let i = 0; i < stock; i++) loc.idx.push(cartons.add(cartonMatrix(loc, i), a.uv));
      locs.push(loc);
      byCode.set(pos.code, loc);
    }
    // Reserve (Ebene 1–3): ~85 % belegt
    const reserveSlots = [];
    for (const pos of allPos.filter(p => p.level > 0)) {
      if (pos.code === bumpLevel(ORDER.short)) continue;   // eigene Nachschubpalette
      if (rnd() < 0.14) continue;
      const a = ARTICLES[Math.floor(rnd() * ARTICLES.length)];
      const y = levelY(pos.level);
      reservePallets.setMatrixAt(reservePallets.count++, new THREE.Matrix4().makeTranslation(pos.x, y, pos.z));
      const h = 0.95 + rnd() * 0.45;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(pos.x, y + 0.144 + h / 2, pos.z), new THREE.Quaternion(), new THREE.Vector3(0.78, h, 1.18));
      blocks.add(m, a.blockUV);
      reserveSlots.push(pos);
    }

    // Blocklager (Getränke) im Nordosten
    const blockFoot = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const x = 6.4 + i * 1.6, z = -11.6 + j * 1.35;
      const a = byId(['wasser', 'wasserm', 'cola', 'apfel', 'orange', 'eistee'][(i + j * 2) % 6]);
      for (let k = 0; k < 2; k++) {
        const y = k * 1.42;
        reservePallets.setMatrixAt(reservePallets.count++, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1)));
        blocks.add(new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.144 + 0.6, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(0.78, 1.2, 1.18)), a.blockUV);
      }
      blockFoot.push({ x, z });
    }
    player.addBox(5.7, -12.4, 12.3, -8.2, 'block');
    footprints.push({ x: 9.0, z: -10.3, w: 6.6, d: 4.2, s: 0.45, blur: 0.3 });

    reservePallets.instanceMatrix.needsUpdate = true;
    reservePallets.computeBoundingSphere();
    root.add(reservePallets);
    cartons.finish(); root.add(cartons.mesh);
    blocks.finish(); root.add(blocks.mesh);
    if (groundPallets) { groundPallets.finish(); root.add(groundPallets.group); }
    groundLQ.instanceMatrix.needsUpdate = true; groundLQ.computeBoundingSphere(); root.add(groundLQ);
    updatePalletLOD();

    // ---------------- Auftrag / Zustand
    const state = {
      phase: 'off', hasMDE: false, jackOnce: false, idx: 0, scanned: null, flash: null, safety: 0, wrongScans: 0, scans: 0,
      lines: ORDER.lines.map(([id, code, qty]) => ({ a: byId(id), loc: byCode.get(code), qty, picked: 0, done: false })),
      wrongTake: new Set(), lastDone: null, repl: 'none', wristVisible: true, weight: 0, cartonsOn: 0, finished: false, caught: [],
    };
    const current = () => state.lines[state.idx];
    // Fortschritt in Auftragspositionen (eine nachgepickte Restmenge zählt nicht als neue Position)
    const posTotal = ORDER.lines.length;
    const posDone = () => state.lines.filter(l => !l.requeued && (l.again ? l.again.done : l.done)).length;

    // Rückseiten der Regalzeilen blockieren Scan-Strahlen ins Nachbargang
    for (const r of ROWS) {
      const b = Interaction.hitBox(0.04, RACK.UPRIGHT_H, ROW_LEN);
      b.position.set(r.x - r.face * (RACK.DEPTH / 2 - 0.05), RACK.UPRIGHT_H / 2, Z_FRONT - ROW_LEN / 2);
      root.add(b);
      interaction.addBlocker(b);
    }

    // Nachschub-Palette über dem Fehlbestand-Platz (wird vom Schubmaststapler heruntergeholt)
    const shortLoc = byCode.get(ORDER.short);
    const replPos = byCode.get(bumpLevel(ORDER.short));
    const replPallet = makeLoadedPallet(shortLoc.a, Math.min(shortLoc.lay.max, 16));
    replPallet.position.set(replPos.x, levelY(1), replPos.z);
    root.add(replPallet);

    // Etiketten (zwei Atlanten, weil es 288 Plätze sind)
    const labA = new Atlas(ctx, { size: 2048, cellW: 256, cellH: 96 });
    const labB = new Atlas(ctx, { size: 2048, cellW: 256, cellH: 96 });
    const itemsA = [], itemsB = [];
    allPos.forEach((pos, i) => {
      const atlas = i < 160 ? labA : labB;
      const canvas = locationLabel(pos.code, { style: pos.level === 0 ? 'yellow' : 'modern', arrow: pos.level === 0 ? 'down' : 'up', w: 512, h: 192 });
      (i < 160 ? itemsA : itemsB).push({ ...pos.label, uv: atlas.add(canvas) });
    });
    rackLabels(ctx, itemsA, labA.texture);
    rackLabels(ctx, itemsB, labB.texture);
    onProgress && onProgress(0.62, 'Arbeitsplätze …');

    // ---------------- Interaktionsziele: Etiketten (scannen) und Kartonstapel (nehmen)
    for (const pos of allPos) {
      const hb = Interaction.hitBox(0.05, 0.11, 0.25);
      hb.position.set(pos.label.x + pos.face * 0.02, pos.label.y, pos.label.z);
      root.add(hb);
      interaction.add({
        object: hb, kind: 'label', color: 0xff3b3b, maxDist: 3.4, maxDistXR: 3.0,
        label: () => `Platzetikett ${pos.code}`,
        sub: () => state.hasMDE ? 'Klick: scannen' : 'Ohne MDE kein Scan – erst Gerät holen',
        onPrimary: (e, hit) => scanLabel(pos, hit, e),
      });
    }
    for (const loc of locs) {
      const h = stackHeight(loc) + 0.16;
      const hb = Interaction.hitBox(0.8, Math.max(0.3, h), 1.2);
      hb.position.set(loc.x, Math.max(0.3, h) / 2, loc.z);
      root.add(hb);
      loc.hit = hb;
      loc.target = interaction.add({
        object: hb, kind: 'stack', priority: 1,
        label: () => `${loc.code} · ${loc.a.name}`,
        sub: () => `${loc.a.pack} · ${loc.stock} Kt. auf der Palette`,
        onPrimary: () => takeCarton(loc),
      });
    }

    // ---------------- Büro, MDE-Ladestation, Hubwagen-Parkplatz
    const deskSize = assets.size('work_table');
    const desk = assets.get('work_table', { fallbackSize: [1.6, 0.9, 0.8] });
    desk.position.copy(SPOTS.desk); desk.rotation.y = -Math.PI / 2; root.add(desk);
    desk.traverse(m => { if (m.isMesh) m.castShadow = false; });
    player.addBoxCentered(SPOTS.desk.x, SPOTS.desk.z, deskSize.z, deskSize.x, 0, 'desk');
    footprints.push({ x: SPOTS.desk.x, z: SPOTS.desk.z, w: deskSize.z, d: deskSize.x, s: 0.4 });
    const noCast = o => { o.traverse(m => { if (m.isMesh) m.castShadow = false; }); return o; };
    if (assets.templates.get('monitor_office')) { const mo = noCast(assets.get('monitor_office')); mo.position.set(SPOTS.desk.x + 0.15, deskSize.y, SPOTS.desk.z); mo.rotation.y = -Math.PI / 2; root.add(mo); }
    if (assets.templates.get('label_printer')) { const lp = noCast(assets.get('label_printer')); lp.position.set(SPOTS.desk.x + 0.05, deskSize.y, SPOTS.desk.z - 0.55); lp.rotation.y = -Math.PI / 2; lp.scale.setScalar(0.85); root.add(lp); }
    placeDeco('lockers', 14.45, -3.7, -Math.PI / 2);
    placeDeco('trash_bin', 14.4, -0.25, -Math.PI / 2);
    placeDeco('extinguisher_stand', 14.35, 3.55, -Math.PI / 2);
    if (assets.templates.get('first_aid')) { const fa = noCast(assets.get('first_aid')); fa.position.set(HALL.w / 2 - 0.16, 1.35, 2.1); fa.rotation.y = -Math.PI / 2; root.add(fa); }
    // Leitplanken um den Bürobereich
    if (assets.templates.get('guard_rail')) {
      const gs = assets.size('guard_rail');
      const len = Math.max(gs.x, gs.z);
      for (let z = -4.2; z < 0.6 - len * 0.5; z += len) placeDeco('guard_rail', 11.55, z + len / 2, gs.x > gs.z ? Math.PI / 2 : 0, false);
      player.addBox(11.45, -4.3, 11.65, 0.6, 'rail');
    }

    const station = makeMDEStation(ctx);
    station.group.position.copy(SPOTS.mde); station.group.rotation.y = -Math.PI / 2;
    root.add(station.group);
    const stationHit = Interaction.hitBox(0.9, 0.5, 0.35);
    stationHit.position.set(0, 1.15, 0.05); station.group.add(stationHit);
    interaction.add({
      object: stationHit, kind: 'button', color: 0x38bdf8, maxDist: 2.6,
      label: 'MDE-Ladestation',
      sub: () => state.hasMDE ? 'Du hast bereits ein MDE' : 'Klick: Scanner-Terminal (MDE) nehmen',
      onPrimary: () => takeMDE(),
    });

    // Hubwagen mit leerer Palette
    const jack = new THREE.Group(); jack.name = 'pallet-jack';
    // Im NVIDIA-Modell zeigen die Gabeln nach +Z → um 180° drehen, damit die Deichsel zum Spieler (+Z) zeigt
    const jackModel = orientedModel(assets, 'pallet_jack', '-Z', () => fallbackJack(ctx));
    jack.add(jackModel.obj);
    const jackPallet = new THREE.Group();
    const jp = palletFit ? palletFit.clone(true) : new THREE.Mesh(palGeo, palMat);
    jackPallet.add(jp);
    jackPallet.position.set(0, 0.085, -jackModel.forkCenter);
    jack.add(jackPallet);
    jack.position.copy(SPOTS.jack); jack.rotation.y = Math.PI * 0.5;
    root.add(jack);
    let jackCollider = player.addCircle(jack.position.x, jack.position.z, 0.75, 'jack');
    const jackHit = Interaction.hitBox(0.9, 1.0, 2.0);
    jackHit.position.set(0, 0.6, -jackModel.forkCenter * 0.6); jack.add(jackHit);
    const loadOnJack = [];    // {a, mesh}
    const packer = { layerY: 0, layerH: 0, rowX: -0.4, rowW: 0, z: -0.6 };
    interaction.add({
      object: jackHit, kind: 'container', color: 0x34d399, priority: 0,
      label: 'Handhubwagen mit Europalette',
      sub: () => player.attached ? 'angekoppelt (F zum Abstellen)' : 'Klick oder F: ankoppeln',
      visibleCheck: () => !player.attached,
      onPrimary: () => toggleJack(),
    });
    function toggleJack() {
      if (player.attached) {
        player.detach();
        jackCollider = player.addCircle(jack.position.x, jack.position.z, 0.75, 'jack');
        audio.play('click');
        ui.toast('Hubwagen abgestellt. Kartons landen trotzdem auf der Palette, solange er in der Nähe steht (max. 4 m).', 'info', 3800);
      } else {
        const hp = engine.headPosition(new THREE.Vector3());
        if (Math.hypot(hp.x - jack.position.x, hp.z - jack.position.z) > 2.8) { ui.toast('Geh näher an den Hubwagen heran (F).', 'warn'); return; }
        player.removeCollider(jackCollider);
        player.attach(jack, { offset: new THREE.Vector3(0.25, 0, -1.55), radius: 0.62 });
        audio.play('click');
        if (!state.jackOnce) { state.jackOnce = true; ui.toast('Hubwagen angekoppelt. In engen Gängen: abstellen (F), picken, weiterfahren.', 'ok', 4200); }
      }
      updateObjective();
    }
    const onCart = () => { if (input.gameActive && !ui.panelOpen) toggleJack(); };
    input.addEventListener('cart', onCart);

    // ---------------- Fahrzeuge
    const vehicles = [];
    const onIncident = () => {
      const m = ctx.currentMission;
      if (m && m.running) m.error('safety', 'Im Fahrweg eines Staplers gestanden (außerhalb des Gehwegs)');
      ui.toast('**Achtung Stapler!** Nicht in den Fahrweg treten – nutze den grünen Gehweg und suche Blickkontakt mit dem Fahrer.', 'error', 5000);
      state.safety++;
    };
    const onWalkway = p => p.x > WALK.minX && p.x < WALK.maxX && p.z > WALK.minZ && p.z < WALK.maxZ;
    // Gegengewichtsstapler: Rundkurs Blocklager ↔ WA 3
    const fl = makeVehicle('forklift', { name: 'stapler', speed: 1.7, loadBack: 0.62 });
    if (fl) {
      fl.setPose(9.75, -4.2, 0);
      const load = makeLoadedPallet(byId('cola'), 12, true);
      const carry = on => () => { if (on) { fl.fork.add(load); load.position.set(0, 0, 0); load.rotation.set(0, 0, 0); } else { load.removeFromParent(); } };
      carry(true)();
      fl.loop([
        { type: 'drive', x: 9.75, z: 6.4 }, { type: 'drive', x: 11.6, z: 8.0 }, { type: 'drive', x: 12.0, z: 9.6 },
        { type: 'lift', h: 0.02, t: 1.2 }, { type: 'call', fn: () => { load.removeFromParent(); dropped.visible = true; } }, { type: 'wait', t: 1.2 },
        { type: 'drive', x: 12.0, z: 7.6, rev: true }, { type: 'drive', x: 10.45, z: 6.0 }, { type: 'drive', x: 10.45, z: -3.0 },
        { type: 'drive', x: 9.75, z: -6.9 }, { type: 'lift', h: 0.1, t: 1 }, { type: 'call', fn: () => { fl.fork.add(load); load.position.set(0, 0, 0); dropped.visible = false; } }, { type: 'wait', t: 1.5 },
        { type: 'drive', x: 9.75, z: -4.2, rev: true }, { type: 'turn', heading: 0 },
      ]);
      const dropped = makeLoadedPallet(byId('cola'), 12, true);
      dropped.position.set(12.0, 0, 11.2); dropped.rotation.y = Math.PI / 2; dropped.visible = false; root.add(dropped);
      vehicles.push(fl);
    }
    // Elektro-Hochhubwagen für den Nachschub aus Ebene 1 (Gabelträger ist ein eigenes, bewegliches Bauteil)
    const reach = makeVehicle('stacker', { name: 'hochhubwagen', speed: 1.15, loadBack: 0.62, turnRate: 1.8 });
    if (reach) { reach.setPose(SPOTS.reachPark.x, SPOTS.reachPark.z, -Math.PI / 2); vehicles.push(reach); }
    // Schubmaststapler (für hohe Ebenen) steht geparkt an der Ladezone
    placeDeco('reach_truck', 14.05, 6.75, Math.PI, true, false);
    function makeVehicle(id, opts) {
      if (!assets.templates.get(id)) return null;
      const info = assets.info(id) || {};
      const v = new Vehicle(ctx, assets.get(id), info.front || '+Z', { ...opts, onIncident });
      return v;
    }

    // ---------------- Warenausgang: Bahnen, Etiketten-Säulen, vorbereitete Paletten
    const waTargets = [];
    for (const d of DOORS) {
      const post = makeWAPost(ctx, d.wa);
      post.position.set(d.x - 1.05, 0, 8.45); post.rotation.y = Math.PI; root.add(post);
      player.addCircle(d.x - 1.05, 8.45, 0.12, 'post');
      const hb = Interaction.hitBox(0.36, 0.22, 0.06);
      hb.position.set(0, 1.42, 0.03); post.add(hb);
      waTargets.push(interaction.add({
        object: hb, kind: 'label', color: 0xff3b3b, maxDist: 3.2,
        label: `Warenausgang ${d.wa}`, sub: () => state.hasMDE ? 'Klick: scannen' : 'MDE fehlt',
        onPrimary: (e, hit) => scanWA(d, hit, e),
      }));
    }
    for (const [id, x, z, ry] of [['pallet_load_wrapped', 3.7, 10.7, 0.05], ['pallet_load_mixed', 4.4, 12.0, -0.04]]) placeDeco(id, x, z, ry, true, true);
    // Leere Paletten gestapelt
    for (let k = 0; k < 9; k++) reservePallets.setMatrixAt(reservePallets.count++, new THREE.Matrix4().compose(new THREE.Vector3(7.4, k * 0.146, 1.0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2 + (k % 2) * 0.03, 0)), new THREE.Vector3(1, 1, 1)));
    reservePallets.instanceMatrix.needsUpdate = true; reservePallets.computeBoundingSphere();
    player.addBox(6.8, 0.55, 8.0, 1.45, 'pallets');
    footprints.push({ x: 7.4, z: 1.0, w: 1.3, d: 0.9, s: 0.5 });

    // ---------------- Bodenmarkierungen
    const lines = [];
    // Gehweg-Ränder (gelb) + Regalfluchten
    lines.push({ x1: WALK.minX, z1: WALK.minZ, x2: WALK.maxX, z2: WALK.minZ, w: 0.08 }, { x1: WALK.minX, z1: WALK.maxZ, x2: WALK.maxX, z2: WALK.maxZ, w: 0.08 });
    for (const r of ROWS) { const xf = r.x + r.face * (RACK.DEPTH / 2 + 0.12); lines.push({ x1: xf, z1: Z_FRONT, x2: xf, z2: Z_FRONT - ROW_LEN, w: 0.07 }); }
    // WA-Bahnen
    for (const d of DOORS) {
      const x0 = d.x - 1.15, x1 = d.x + 1.15, z0 = 8.75, z1 = 12.55;
      lines.push({ x1: x0, z1: z0, x2: x1, z2: z0, w: 0.07 }, { x1: x0, z1: z0, x2: x0, z2: z1, w: 0.07 }, { x1: x1, z1: z0, x2: x1, z2: z1, w: 0.07 });
    }
    floorLines(ctx, lines, { color: 0xe8b923, roughness: 0.6 });
    // Gehweg (grün)
    floorLines(ctx, [{ x1: WALK.minX + 0.05, z1: (WALK.minZ + WALK.maxZ) / 2, x2: WALK.maxX - 0.05, z2: (WALK.minZ + WALK.maxZ) / 2, w: WALK.maxZ - WALK.minZ - 0.12 }], { color: 0x2f7d4f, roughness: 0.7, y: 0.002 });
    // Zebrastreifen an der Staplerkreuzung
    const zebra = [];
    for (let i = 0; i < 6; i++) { const x = 9.35 + i * 0.3; zebra.push({ x1: x, z1: WALK.minZ + 0.06, x2: x, z2: WALK.maxZ - 0.06, w: 0.16 }); }
    floorLines(ctx, zebra, { color: 0xf3f3ee, roughness: 0.6, y: 0.0035 });
    // Piktogramme & Gangnummern
    for (let x = -12; x <= 12; x += 6) decal(ctx, pedestrianCanvas(), x, (WALK.minZ + WALK.maxZ) / 2, 0.85, 0.85, Math.PI);
    for (const a of AISLES) decal(ctx, floorNumberCanvas(a.gang), a.x, Z_FRONT - 1.6, 1.3, 0.75, 0);
    for (const d of DOORS) decal(ctx, floorNumberCanvas(d.wa), d.x, 10.6, 1.6, 0.7, Math.PI);
    // Warnstreifen an den Torkanten
    const hzMat = new THREE.MeshStandardMaterial({ map: mat.hazardTexture().clone(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    hzMat.map.repeat.set(6, 0.5); hzMat.map.needsUpdate = true; ctx.track(hzMat.map); ctx.track(hzMat);
    for (const d of DOORS) { const p = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.35), hzMat); p.rotation.x = -Math.PI / 2; p.position.set(d.x, 0.004, HALL.d / 2 - 0.35); root.add(p); }

    // ---------------- Schilder
    for (const a of AISLES) {
      const s = signMesh(ctx, signCanvas(`GANG ${a.gang}`, { sub: 'Plätze 01 – 24 · links ungerade', bg: '#103a7a', fg: '#ffffff', w: 768, h: 288 }), 1.8, 0.68, { emissive: 0.15 });
      s.position.set(a.x, 3.9, Z_FRONT + 0.25); root.add(s);
      for (const dx of [-0.8, 0.8]) { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, HALL.h - 4.25, 4), mat.basic(0x333333, 0.6, 0.8)); ch.position.set(a.x + dx, (HALL.h + 4.25) / 2, Z_FRONT + 0.25); root.add(ch); }
    }
    const waSign = signMesh(ctx, signCanvas('WARENAUSGANG', { sub: 'Rampe 1 · 2 · 3', bg: '#f08a24', fg: '#111111', w: 1024, h: 256 }), 4.2, 1.05);
    waSign.position.set(8.0, 5.3, HALL.d / 2 - 0.17); waSign.rotation.y = Math.PI; root.add(waSign);
    for (const d of DOORS) { const r = signMesh(ctx, signCanvas(`Rampe ${d.wa.slice(-1)}`, { bg: '#111111', fg: '#ffffff', w: 512, h: 160 }), 1.1, 0.34); r.position.set(d.x, 4.05, HALL.d / 2 - 0.17); r.rotation.y = Math.PI; root.add(r); }
    const mdeSign = signMesh(ctx, signCanvas('MDE-Ladestation', { sub: 'Gerät nehmen · nach Schicht zurück', bg: '#0b1220', fg: '#38bdf8', w: 768, h: 220 }), 1.3, 0.37, { emissive: 0.2 });
    mdeSign.position.set(HALL.w / 2 - 0.16, 2.2, SPOTS.mde.z); mdeSign.rotation.y = -Math.PI / 2; root.add(mdeSign);
    const warn = makeWarningSign(ctx);
    warn.position.set(8.55, 0, 3.75); warn.rotation.y = Math.PI; root.add(warn); player.addCircle(8.55, 3.75, 0.1);

    // ---------------- Scanner (MDE) in der Hand + Laser
    const scanner = makeScanner(ctx);
    scanner.group.visible = false;
    const placeScanner = () => {
      const c = input.controller('right');
      if (engine.isXR && c) { c.grip.add(scanner.group); scanner.group.position.set(0, -0.02, -0.03); scanner.group.rotation.set(-0.35, 0, 0); scanner.group.scale.setScalar(1); }
      else { engine.camera.add(scanner.group); scanner.group.position.set(0.25, -0.27, -0.52); scanner.group.rotation.set(0.12, -0.12, 0.05); scanner.group.scale.setScalar(1); }
      scanner.group.visible = state.hasMDE;
    };
    placeScanner();
    const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9, toneMapped: false, depthTest: false }));
    laser.frustumCulled = false; laser.visible = false; laser.renderOrder = 50; laser.userData.noEnvCapture = true;
    root.add(laser);
    const laserDot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }));
    laserDot.visible = false; root.add(laserDot);
    let laserT = 0;
    function fireLaser(point) {
      const from = scanner.nose.getWorldPosition(new THREE.Vector3());
      const pts = laser.geometry.attributes.position;
      pts.setXYZ(0, from.x, from.y, from.z); pts.setXYZ(1, point.x, point.y, point.z); pts.needsUpdate = true;
      laser.geometry.computeBoundingSphere();
      laser.visible = true; laserDot.visible = true; laserDot.position.copy(point);
      laserT = 0.18;
    }

    // MDE-Bildschirm: Desktop im HUD, VR am linken Handgelenk
    ui.device.resize(600, 900);
    const wrist = new THREE.Group();
    const wFrame = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.245, 0.022), mat.basic(0x1d2329, 0.45, 0.2));
    const wScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.225), new THREE.MeshBasicMaterial({ map: ui.device.texture, toneMapped: false }));
    wScreen.position.z = 0.0115;
    const wBump = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.03), mat.basic(0xf2b705, 0.5, 0.1)); wBump.position.set(0, 0.13, -0.002);
    wrist.add(wFrame, wScreen, wBump);
    wrist.visible = false; wrist.userData.noEnvCapture = true;
    ctx.track(wFrame.geometry); ctx.track(wScreen.geometry); ctx.track(wScreen.material); ctx.track(wBump.geometry);
    const placeWrist = () => {
      const c = input.controller('left');
      if (engine.isXR && c) { c.grip.add(wrist); wrist.position.set(0.0, 0.06, -0.05); wrist.rotation.set(-1.0, 0, 0); }
      else if (wrist.parent) wrist.removeFromParent();
      wrist.visible = engine.isXR && state.hasMDE && state.wristVisible !== false;
    };
    const onXR = () => { placeScanner(); placeWrist(); drawDevice(); updatePalletLOD(); };
    engine.addEventListener('xrstart', onXR); engine.addEventListener('xrend', onXR); input.addEventListener('controllerconnected', onXR);
    engine.addEventListener('quality', updatePalletLOD);
    const onDevice = () => { if (!input.gameActive || !state.hasMDE) return; if (engine.isXR) { state.wristVisible = state.wristVisible === false; placeWrist(); } else ui.device.toggleBig(); };
    input.addEventListener('device', onDevice);
    const onConfirm = () => { if (input.gameActive && !ui.panelOpen && state.phase === 'short') reportShort(); };
    input.addEventListener('confirm', onConfirm);

    function flash(text, type = 'info', t = 2.2) { state.flash = { text, type, t }; drawDevice(); }
    function drawDevice() {
      drawMDE(ui.device.ctx, 600, 900, { ...state, phase: state.hasMDE ? state.phase : 'off', order: ORDER, xr: engine.isXR, cartons: state.cartonsOn, weight: state.weight, posDone: posDone(), posTotal });
      ui.device.update();
    }

    function takeMDE() {
      if (state.hasMDE) return;
      state.hasMDE = true;
      station.take();
      audio.play('ok');
      placeScanner(); placeWrist();
      ui.device.show(true);
      ui.device.setCaption('MDE · <kbd>Tab</kbd> groß/klein · <kbd>Leertaste</kbd> Fehlmenge');
      state.phase = 'login';
      drawDevice();
      setTimeout(() => {
        if (state.phase !== 'login') return;
        state.phase = 'goto'; audio.play('scan');
        flash(`Auftrag ${ORDER.no} zugewiesen`, 'ok', 2.5);
        ui.toast(`Auftrag **${ORDER.no}** auf dem MDE: ${state.lines.length} Positionen. Hol jetzt den **Hubwagen** (F).`, 'ok', 4500);
        updateObjective();
      }, 1400);
      updateObjective();
    }

    function scanLabel(pos, hit, e) {
      if (!state.hasMDE) { ui.toast('Ohne **MDE** kannst du nicht scannen. Die Ladestation ist an der Ostwand.', 'warn'); return; }
      if (hit) fireLaser(hit.point);
      audio.play('scan');
      state.scans++;
      ctx.currentMission && ctx.currentMission.scan();
      const ln = current();
      if (state.phase === 'goto' || state.phase === 'take' || state.phase === 'wait') {
        if (ln && pos.code === ln.loc.code) {
          if (state.phase === 'take') { flash('Platz bereits gescannt', 'info', 1.2); return; }
          state.scanned = ln.loc;
          if (ln.loc.stock <= 0) {
            if (state.repl === 'running') { state.phase = 'wait'; flash('Nachschub unterwegs – kurz warten', 'warn', 3); }
            else { state.phase = 'short'; flash('Platz leer!', 'error', 3); audio.play('warn'); }
          } else { state.phase = 'take'; flash('Platz bestätigt ✔', 'ok', 1.4); audio.play('ok'); }
          updateObjective();
        } else {
          // vom MDE abgefangen → kein Pickfehler, wird aber in der Auswertung gezeigt
          state.wrongScans++;
          state.caught.push(`Fehlscan ${pos.code} statt ${ln ? ln.loc.code : '–'}`);
          audio.play('error');
          flash(`Falscher Platz: ${pos.code}`, 'error', 2.6);
          ui.toast(`Falscher Lagerplatz! Gescannt **${pos.code}**, gesucht **${ln.loc.code}**. Das MDE verhindert hier einen Pickfehler.`, 'error', 4200);
        }
      } else if (state.phase === 'deliver') {
        flash('Jetzt das WA-Etikett scannen', 'warn', 2);
      } else {
        flash('Kein Scan erwartet', 'info', 1.2);
      }
      drawDevice();
    }

    function jackNear(p) { return jack.position.distanceTo(new THREE.Vector3(p.x, 0, p.z)) < 4.6; }

    function takeCarton(loc) {
      if (!state.hasMDE) { ui.toast('Hol dir zuerst ein **MDE** an der Ladestation – ohne Buchung keine Entnahme.', 'warn'); return; }
      const ln = current();
      if (state.phase === 'login') return;
      if (!ln || state.phase === 'deliver' || state.phase === 'wrap' || state.phase === 'done') { ui.toast('Alle Positionen sind kommissioniert. Ab zum Warenausgang!', 'info'); return; }
      if (loc !== ln.loc) {
        if (state.lastDone && state.lastDone.loc === loc && performance.now() - state.lastDone.t < 8000) { ui.toast('Menge ist schon vollständig – nichts mehr nehmen.', 'info', 2200); audio.play('warn'); return; }
        if (!state.wrongTake.has(state.idx)) {
          state.wrongTake.add(state.idx);
          state.caught.push(`Griff zu ${loc.code} statt ${ln.loc.code}`);
        }
        audio.play('error');
        flash(`Falscher Platz! Soll ${ln.loc.code}`, 'error', 2.6);
        ui.toast(`Stopp: Das ist **${loc.code}** (${loc.a.name}). Das MDE erwartet **${ln.loc.code}**.`, 'error', 3800);
        return;
      }
      if (state.phase === 'goto') { flash('Erst Platzetikett scannen!', 'warn', 2.2); ui.toast('Erst das **gelbe Platzetikett** (▼) an der Traverse scannen – dann entnehmen.', 'warn', 3200); audio.play('warn'); return; }
      if (state.phase === 'wait') { flash('Nachschub läuft …', 'warn', 2); return; }
      if (state.phase === 'short') { flash('Fehlmenge melden (Leertaste)', 'warn', 2); return; }
      if (!jackNear(loc)) { ui.toast('Der Hubwagen steht zu weit weg (max. 4 m). Hol ihn heran (F).', 'warn', 3200); return; }
      if (loc.stock <= 0) { state.phase = 'short'; drawDevice(); updateObjective(); return; }
      // Karton vom Stapel nehmen (oberster zuerst)
      loc.stock--;
      const ii = loc.idx.pop();
      const from = new THREE.Vector3().setFromMatrixPosition(cartons.matrices[ii]);
      cartons.setVisible(ii, false);
      flyToJack(loc.a, from);
      ln.picked++;
      ctx.currentMission && ctx.currentMission.pick(1);
      audio.play('pick');
      if (ln.picked >= ln.qty) {
        ln.done = true;
        if (!ln.partial) ctx.currentMission && ctx.currentMission.line(1);
        state.lastDone = { loc, t: performance.now() };
        audio.play('ok');
        flash(`Position bestätigt ✔ ${ln.qty}/${ln.qty}`, 'ok', 1.6);
        nextLine();
      } else if (loc.stock <= 0) {
        state.phase = 'short';
        flash('Platz leer! Fehlmenge?', 'error', 3);
        audio.play('warn');
        updateObjective();
      }
      drawDevice();
    }

    function nextLine() {
      state.scanned = null;
      state.idx++;
      while (state.idx < state.lines.length && state.lines[state.idx].done) state.idx++;
      if (state.idx >= state.lines.length) {
        state.phase = 'deliver';
        ui.toast(`Alle Positionen kommissioniert! Bring die Palette zum **${ORDER.dock}** (Rampe 2) und scanne das Etikett.`, 'ok', 5000);
      } else {
        state.phase = 'goto';
      }
      updateObjective();
      drawDevice();
    }

    function reportShort() {
      const ln = current();
      if (!ln) return;
      audio.play('button');
      const rest = ln.qty - ln.picked;
      ln.done = true; ln.partial = true;
      ln.shortReported = true;
      // Bestandskorrektur in Echtzeit + Nachschubauftrag; Restmenge zwei Positionen später erneut
      ln.loc.systemStock = ln.loc.stock;
      const again = { a: ln.a, loc: ln.loc, qty: rest, picked: 0, done: false, requeued: true };
      ln.again = again;
      state.lines.splice(Math.min(state.idx + 3, state.lines.length), 0, again);
      flash('Fehlmenge gebucht · Nachschub läuft', 'ok', 3);
      ui.toast(`Fehlmenge gemeldet: Der Bestand wird sofort korrigiert und ein **Nachschubauftrag** geht an den Hochhubwagen. Die restlichen **${rest} Kt.** pickst du später.`, 'info', 6000);
      startReplenishment(ln.loc);
      nextLine();
    }

    function startReplenishment(loc) {
      state.repl = 'running';
      if (!reach) {
        // ohne Modell: Ware einfach nach kurzer Zeit auffüllen
        setTimeout(() => finishReplenishment(loc), 12000);
        return;
      }
      const faceHeading = loc.face > 0 ? -Math.PI / 2 : Math.PI / 2;   // Fahrzeug blickt aufs Regal
      const back = reach.frontExt - (reach.opts.loadBack ?? 0.55);        // Fahrzeugmitte → Lastmitte
      // Fahrspur so wählen, dass die Gabelspitzen nach dem Eindrehen genau vor der Regalfront stehen
      const turnX = loc.xFront + loc.face * (reach.frontExt + 0.06);
      const standX = loc.x + loc.face * back;                             // Gabeln mittig unter der Palette
      reach.queue.length = 0; reach.cmd = null; reach.loopCmds = null;
      reach
        .drive(turnX, 6.3).drive(turnX, Z_FRONT + 0.6).drive(turnX, loc.z)
        .turn(faceHeading)
        .lift(levelY(1) - 0.04, 2.4)                                       // Gabel auf Höhe Ebene 1
        .drive(standX, loc.z, { speed: 0.35 })                             // einfahren
        .call(() => { reach.fork.attach(replPallet); })
        .lift(levelY(1) + 0.07, 0.8)                                       // Palette anheben
        .drive(turnX, loc.z, { rev: true, speed: 0.35 })                   // ausfahren
        .lift(0.0, 3.2)                                                    // absenken
        .call(() => { hideGroundPallet(loc); })                            // leere Palette tauschen
        .drive(standX, loc.z, { speed: 0.3 })                              // auf den Bodenplatz schieben
        .lift(-0.04, 0.6)
        .call(() => { root.attach(replPallet); replPallet.visible = false; finishReplenishment(loc); })
        .drive(turnX, loc.z, { rev: true, speed: 0.45 })
        .lift(0.06, 0.6)
        .turn(Math.PI)
        .drive(turnX, Z_FRONT + 0.6).drive(turnX, 6.3).drive(SPOTS.reachPark.x, SPOTS.reachPark.z)
        .turn(-Math.PI / 2);
    }
    function hideGroundPallet(loc) {
      // leere Palette tauschen: alte Instanz ausblenden
      setGroundPalletVisible(loc.pallet, false);
    }
    function finishReplenishment(loc) {
      setGroundPalletVisible(loc.pallet, true);
      const n = Math.min(loc.lay.max, 16);
      loc.idx = [];
      for (let i = 0; i < n; i++) loc.idx.push(cartons.add(cartonMatrix(loc, i), loc.a.uv));
      cartons.finish();
      loc.stock = n; loc.systemStock = n;
      state.repl = 'done';
      ui.toast(`Nachschub da: **${loc.code}** ist wieder voll (${n} Kt.).`, 'ok', 3500);
      audio.play('ok');
      const ln = current();
      if (ln && ln.loc === loc && state.phase === 'wait') { state.phase = 'take'; flash('Nachschub da – entnehmen', 'ok', 2); }
      updateObjective(); drawDevice();
    }

    // Karton fliegt auf die Hubwagen-Palette (einfaches Lagenschema)
    const flights = [];
    function cartonMesh(a) {
      if (!jackMatCache.has(a.id)) {
        const t = cartonAtlas.texture.clone(); t.needsUpdate = true; ctx.track(t);
        const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.82 }); ctx.track(m);
        // Atlas-Ausschnitt über UV-Transformation
        t.repeat.set(a.uv.w, a.uv.h); t.offset.set(a.uv.u, a.uv.v);
        jackMatCache.set(a.id, m);
      }
      const mesh = new THREE.Mesh(cartonGeo, jackMatCache.get(a.id));
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
    // Höhenkarte der Ladefläche (5-cm-Raster): jeder Karton kommt an die niedrigste freie Stelle (schwer zuerst → unten)
    const HM = { nx: 16, nz: 24, c: 0.05, h: new Float32Array(16 * 24) };
    function nextJackSlot(a) {
      const [L, H, W] = a.dims;
      let best = null;
      for (const rot of [0, 1]) {
        const fx = Math.min(HM.nx, Math.ceil((rot ? L : W) / HM.c - 0.05)), fz = Math.min(HM.nz, Math.ceil((rot ? W : L) / HM.c - 0.05));
        for (let iz = 0; iz + fz <= HM.nz; iz++) for (let ix = 0; ix + fx <= HM.nx; ix++) {
          let base = 0, minB = 9;
          for (let z = iz; z < iz + fz; z++) for (let x = ix; x < ix + fx; x++) { const v = HM.h[z * HM.nx + x]; if (v > base) base = v; if (v < minB) minB = v; }
          const gap = base - minB;                     // Hohlraum unter dem Karton vermeiden
          const score = base * 10 + gap * 4 + (iz + ix) * 0.002 + rot * 0.001;
          if (!best || score < best.score) best = { score, base, ix, iz, fx, fz, rot };
        }
      }
      const b = best;
      for (let z = b.iz; z < b.iz + b.fz; z++) for (let x = b.ix; x < b.ix + b.fx; x++) HM.h[z * HM.nx + x] = b.base + H;
      packer.layerY = Math.max(packer.layerY, b.base + H);
      return { pos: new THREE.Vector3(-0.4 + (b.ix + b.fx / 2) * HM.c, 0.144 + b.base + H / 2, -0.6 + (b.iz + b.fz / 2) * HM.c), rot: b.rot };
    }
    function flyToJack(a, fromWorld) {
      const m = cartonMesh(a);
      m.scale.set(a.dims[2], a.dims[1], a.dims[0]);
      const slot = nextJackSlot(a);
      const target = slot.pos;
      m.rotation.y = slot.rot ? Math.PI / 2 : 0;
      jackPallet.updateMatrixWorld(true);
      const start = jackPallet.worldToLocal(fromWorld.clone());
      m.position.copy(start);
      jackPallet.add(m);
      loadOnJack.push({ a, mesh: m });
      state.cartonsOn++; state.weight += a.kg;
      flights.push({ obj: m, start, target, t: 0, rot0: m.rotation.y });
    }

    function scanWA(d, hit) {
      if (!state.hasMDE) { ui.toast('Ohne MDE kein Scan.', 'warn'); return; }
      if (hit) fireLaser(hit.point);
      audio.play('scan');
      state.scans++; ctx.currentMission && ctx.currentMission.scan();
      if (state.phase !== 'deliver') { flash(state.phase === 'done' ? 'Auftrag ist erledigt' : 'Erst alle Positionen picken', 'warn', 2); drawDevice(); return; }
      if (d.wa !== ORDER.dock) {
        state.wrongScans++;
        state.caught.push(`${d.wa} statt ${ORDER.dock}`);
        audio.play('error');
        flash(`Falsches Tor: ${d.wa}`, 'error', 2.6); ui.toast(`Falscher Warenausgang! Diese Palette gehört an **${ORDER.dock}** – das MDE hat es bemerkt.`, 'error'); drawDevice();
        return;
      }
      const target = new THREE.Vector3(d.x, 0, 10.6);
      if (jack.position.distanceTo(target) > 4.5) { flash('Hubwagen fehlt am WA', 'warn', 2.5); ui.toast('Bring den Hubwagen mit der Palette in die Bahn **WA 2**.', 'warn'); drawDevice(); return; }
      deliver(d);
    }

    function deliver(d) {
      state.phase = 'wrap';
      audio.play('ok');
      if (player.attached) player.detach();
      // Palette in die WA-Bahn stellen und mit Folie wickeln
      jack.position.set(d.x, 0, 10.4); jack.rotation.y = Math.PI;
      jackCollider = player.addCircle(jack.position.x, jack.position.z, 0.75, 'jack');
      const h = packer.layerY + 0.03;
      const film = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1, 1.24), new THREE.MeshStandardMaterial({ color: 0xe6eef8, transparent: true, opacity: 0.32, roughness: 0.12, metalness: 0, depthWrite: false }));
      ctx.track(film.geometry); ctx.track(film.material);
      film.position.set(0, 0.144, 0); film.scale.y = 0.001;
      jackPallet.add(film);
      let t = 0;
      wrapAnim = dt => {
        t += dt;
        const k = Math.min(1, t / 3.2);
        film.scale.y = Math.max(0.001, h * k);
        film.position.y = 0.144 + film.scale.y / 2;
        film.rotation.y = Math.sin(t * 6) * 0.004;
        if (k >= 1) { wrapAnim = null; state.phase = 'done'; drawDevice(); setTimeout(finishMission, 700); }
      };
      drawDevice(); updateObjective();
    }
    let wrapAnim = null;

    function finishMission() {
      if (state.finished) return;
      state.finished = true;
      const m = ctx.currentMission;
      const r = m.finish({ cartons: state.cartonsOn });
      const prev = loadResults().lager1;
      const blocks = [
        { h: 'Dein Auftrag' },
        { table: { head: ['Kennzahl', 'Wert'], rows: [
          ['Positionen', `${r.lines} von 9`], ['Kartons auf der Palette', `${state.cartonsOn} (${fmtNum(state.weight)} kg)`],
          ['Scans', String(state.scans)],
          ['Fehlgriffe/Fehlscans – vom MDE abgefangen', { t: String(state.caught.length), cls: state.caught.length ? 'st-warn' : 'st-ok' }],
          ['Pickfehler beim Kunden', { t: '0', cls: 'st-ok' }],
          ['Sicherheitsverstöße', { t: String(state.safety), cls: state.safety ? 'st-err' : 'st-ok' }],
        ] } },
      ];
      if (state.caught.length) blocks.push({ p: `Abgefangen: ${state.caught.slice(0, 4).join(' · ')}${state.caught.length > 4 ? ' …' : ''}. Ohne Scanner wären das echte **Pickfehler** gewesen – so kosteten sie nur Zeit.` });
      if (prev && prev.last) {
        blocks.push({ h: 'Vergleich mit Lager 01 (Papierliste)' });
        blocks.push({ table: { head: ['', 'Lager 01', 'Lager 02'], rows: [
          ['Pickfehler', String(prev.last.errorCount), String(r.errorCount)],
          ['Positionen pro Stunde', fmtNum(prev.last.linesPerHour), fmtNum(r.linesPerHour)],
          ['Laufweg', fmtNum(prev.last.distance) + ' m', fmtNum(r.distance) + ' m'],
        ] } });
      }
      blocks.push({ callout: 'Mit **Pick-by-Scan** prüft das System jeden Schritt sofort: falscher Platz, falscher Artikel, falsche Menge – alles wird **verhindert statt erst bei der Kontrolle entdeckt**. Jede Entnahme wird in **Echtzeit gebucht**, deshalb fiel der Fehlbestand sofort auf und der Nachschub startete automatisch.', tone: 'teal' });
      ctx.complete(r, {
        blocks,
        lesson: `Das MDE führt dich Schritt für Schritt (beleglose Kommissionierung). Trotzdem bist du **${fmtNum(r.distance)} m** gelaufen – Mann-zur-Ware bleibt lauf-intensiv. Wegzeitanteil: **${fmtNum(r.walkShare * 100)} %**.`,
      });
    }

    // ---------------- Ziele / HUD
    function updateObjective() {
      const ln = current();
      let t;
      if (!state.hasMDE) t = 'Hol dir an der **MDE-Ladestation** (Ostwand, beim Büro) ein Scanner-Terminal.';
      else if (state.phase === 'login') t = 'Das MDE lädt deinen Auftrag …';
      else if (!state.jackOnce && !player.attached) t = 'Nimm den **Hubwagen** mit der leeren Palette (Taste **F** oder anklicken).';
      else if (state.phase === 'goto') t = `Gehe zu **${ln.loc.code}** und scanne das **gelbe Platzetikett** (▼) an der Traverse.`;
      else if (state.phase === 'take') t = `Nimm **${ln.qty - ln.picked} × ${ln.a.name}** (${ln.a.pack}) von der Palette.`;
      else if (state.phase === 'short') t = 'Der Platz ist leer! Melde die **Fehlmenge** (**Leertaste** / VR: **X**).';
      else if (state.phase === 'wait') t = 'Nachschub läuft – der **Hochhubwagen** holt die Reservepalette aus Ebene 1. Abstand halten!';
      else if (state.phase === 'deliver') t = `Bring die Palette zum **${ORDER.dock}** (Rampe 2) und scanne das Etikett an der Säule.`;
      else if (state.phase === 'wrap') t = 'Die Palette wird mit Stretchfolie gesichert …';
      else t = 'Auftrag erledigt!';
      ui.setObjective(t);
    }
    player.addEventListener('attach', updateObjective); player.addEventListener('detach', updateObjective);

    const totalCartons = ORDER.lines.reduce((s, l) => s + l[2], 0);
    const headP = new THREE.Vector3();
    ctx.onUpdate(dt => {
      // Flugbahnen der Kartons
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        f.t = Math.min(1, f.t + dt / 0.45);
        const k = 1 - Math.pow(1 - f.t, 3);
        f.obj.position.lerpVectors(f.start, f.target, k);
        f.obj.position.y += Math.sin(k * Math.PI) * 0.35;
        f.obj.rotation.y = f.rot0 + (1 - k) * 0.6;
        if (f.t >= 1) { flights.splice(i, 1); audio.play('put'); }
      }
      if (wrapAnim) wrapAnim(dt);
      if (laserT > 0) { laserT -= dt; if (laserT <= 0) { laser.visible = false; laserDot.visible = false; } }
      if (state.flash && state.flash.t > 0) { state.flash.t -= dt; if (state.flash.t <= 0) drawDevice(); }
      engine.headPosition(headP);
      for (const v of vehicles) v.update(dt, headP, onWalkway);
      const m = ctx.currentMission;
      if (m && m.running) {
        ui.setStats([
          { label: 'Zeit', value: fmtTime(m.elapsed) },
          { label: 'Position', value: `${Math.min(posDone() + 1, posTotal)}/${posTotal}` },
          { label: 'Kartons', value: `${state.cartonsOn}/${totalCartons}` },
          { label: 'Abgefangen', value: String(state.caught.length), cls: state.caught.length ? 'err' : '' },
          ...(state.safety ? [{ label: 'Sicherheit', value: String(state.safety), cls: 'err' }] : []),
          { label: 'Laufweg', value: fmtNum(player.distance) + ' m' },
        ]);
      }
    });
    // MDE-Uhr / Blinken regelmäßig neu zeichnen
    let devT = 0;
    ctx.onUpdate(dt => { devT += dt; if (devT > 1 && state.hasMDE) { devT = 0; drawDevice(); } });

    // ---------------- Licht
    const fixtures = [];
    for (let x = -13; x <= 13.1; x += 3.25) for (let z = -10.8; z <= 11; z += 4.3) fixtures.push({ x, z });
    setupLighting(ctx, {
      sky: 0xdfe9f6, ground: 0x6a655d, hemi: 0.55, key: 2.0, keyColor: 0xf4f8ff, keyDir: [-0.34, 1, 0.32],
      fixtures, fixtureKind: 'highbay', fixtureHeight: 8.2, ceilingY: HALL.h, lampColor: 0xeef4ff, lampIntensity: 7,
      points: [{ x: 8, y: 3.2, z: 11.6, intensity: 24, distance: 12, color: 0xfff0d8 }, { x: 13.2, y: 3.4, z: 0.2, intensity: 14, distance: 8, color: 0xf2f6ff }],
      background: 0x2a3036, shadowExtent: 10,
    });

    bakeFloorAO(ctx, hall.floor, HALL.w, HALL.d, footprints, { edge: 0.8, edgeStrength: 0.4 });

    // ---------------- Infopunkte
    const info = (x, y, z, card) => ctx.addInfoPoint(new THREE.Vector3(x, y, z), card);
    info(-6.8, 2.6, Z_FRONT + 0.9, {
      title: 'Das Palettenregal', subtitle: 'Ständer, Traverse, Fachlast',
      blocks: [
        { p: '**Palettenregale** lagern ganze Paletten in mehreren Ebenen. Sie bestehen aus **Ständerrahmen** (blau, mit Lochung) und **Traversen** (orange Querträger), auf denen die Paletten stehen.' },
        { list: ['**Fachlast:** maximales Gewicht pro Traversenpaar – steht auf dem Typenschild und darf nie überschritten werden.', '**Feldlast:** Gesamtgewicht eines Regalfeldes.', '**Rammschutz** (gelb) schützt die Ständer vor Staplern – ein verbogener Ständer kann das ganze Regal zum Einsturz bringen.'] },
        { callout: 'Bei Nordstern ist die **Bodenebene (Ebene 0)** der Kommissionierplatz. In den Ebenen 1–3 darüber liegen **Reservepaletten** für den Nachschub.', tone: 'teal' },
      ],
    });
    info(SPOTS.mde.x - 0.5, 2.2, SPOTS.mde.z - 0.8, {
      title: 'Barcode & MDE', subtitle: 'Pick-by-Scan',
      blocks: [
        { p: 'Ein **MDE** (mobiles Datenerfassungsgerät) ist ein robuster Handcomputer mit Barcode-Scanner. Es ist per WLAN mit dem **Lagerverwaltungssystem (LVS/WMS)** verbunden.' },
        { list: ['Auf jedem Karton steht eine **EAN-13** (Europäische Artikelnummer) – 13 Ziffern, die letzte ist eine **Prüfziffer**.', 'Lagerplätze haben eigene Barcodes. Der Scan beweist: Du stehst am richtigen Platz.', 'Jede Entnahme wird sofort **gebucht** – der Bestand im System stimmt in **Echtzeit**.'] },
        { callout: 'Weil das Gerät dich führt, spricht man von **belegloser Kommissionierung** – kein Papier, weniger Fehler.' },
      ],
    });
    info(-1.45, 2.6, Z_FRONT + 0.9, {
      title: 'Chaotische Lagerhaltung', subtitle: 'Freiplatzsystem',
      blocks: [
        { p: 'Bei Nordstern hat ein Artikel **keinen festen Platz**: Neue Ware kommt dorthin, wo gerade Platz frei ist. Apfelsaft steht zum Beispiel auf **02-08-0** und auf **03-15-0**.' },
        { list: ['**+** Platz wird optimal genutzt (bis zu 30 % weniger Fläche als beim Festplatzsystem)', '**+** Einlagerung geht schneller', '**–** Ohne LVS findet niemand etwas – das System merkt sich jeden Platz', '**FEFO** (First Expired – First Out): Das MDE schickt dich zuerst zur Palette mit dem ältesten MHD.'] },
      ],
    });
    info(-12.15, 2.6, Z_FRONT + 0.9, {
      title: 'Nachschub & Reserveplätze', subtitle: 'Damit der Pickplatz nie leer ist',
      blocks: [
        { p: 'Wird ein **Kommissionierplatz** leer, holt ein Stapler eine volle Palette vom **Reserveplatz** darüber – das ist ein **Nachschubauftrag**.' },
        { p: 'Das LVS löst den Nachschub automatisch aus, sobald ein **Mindestbestand** unterschritten ist. Stimmt der Bestand im System nicht (Fehlbestand), meldet der Picker die **Fehlmenge** per MDE.' },
        { callout: 'Für Ebene 1 genügt ein **Elektro-Hochhubwagen**. Die hohen Ebenen bedient der **Schubmaststapler**: Er braucht weniger Platz zum Wenden als ein Gegengewichtsstapler und passt in schmale Gänge.', tone: 'teal' },
      ],
    });
    info(8.55, 2.75, 3.75, {
      title: 'Arbeitssicherheit', subtitle: 'Fußgänger und Stapler',
      blocks: [
        { list: ['Nutze die **grünen Gehwege** und quere Fahrwege nur an **Zebrastreifen**.', 'Suche **Blickkontakt** mit dem Fahrer, bevor du einen Fahrweg betrittst.', 'Der **Blue Spot** (blauer Lichtpunkt am Boden) warnt: Hier kommt gleich ein Stapler.', 'Ein piepender Stapler fährt **rückwärts** – der Fahrer sieht dich schlecht.', '**PSA**: Sicherheitsschuhe sind Pflicht, im Wareneingang oft Warnweste.'] },
        { callout: 'Ein beladener Stapler wiegt mehrere Tonnen und hat einen langen Bremsweg. Stapler haben im Lager praktisch **immer Vorrang**.' },
      ],
    });
    info(8.0, 2.2, 8.2, {
      title: 'Ladungssicherung & Packschema', subtitle: 'Schwer nach unten',
      blocks: [
        { p: 'Das MDE gibt die Reihenfolge vor: **schwere Kartons zuerst** (sie kommen nach unten), leichte und empfindliche zuletzt (oben).' },
        { list: ['Kartons **im Verbund** stapeln, nicht über den Palettenrand hinaus.', 'Am Warenausgang wird die Palette mit **Stretchfolie** gewickelt – so verrutscht nichts beim Transport.', 'Gewicht und Höhe der Palette müssen zum Lkw und zum Kunden passen.'] },
      ],
    });

    // ---------------- Hilfsfunktionen im Level
    function placeDeco(id, x, z, ry, collide = true, cast = false) {
      if (!assets.templates.get(id)) return null;
      const o = assets.get(id);
      o.position.set(x, 0, z); o.rotation.y = ry; root.add(o);
      if (!cast) o.traverse(m => { if (m.isMesh) m.castShadow = false; });
      const s = assets.size(id);
      if (collide) player.addCircle(x, z, Math.max(s.x, s.z) * 0.45, id);
      footprints.push({ x, z, w: s.x * 0.9, d: s.z * 0.9, s: 0.4 });
      return o;
    }
    function cartonMatrix(loc, i) {
      const [L, H, W] = loc.a.dims;
      const lp = loc.lay.pos(i);
      return new THREE.Matrix4().compose(new THREE.Vector3(loc.x + lp.x, 0.144 + lp.y, loc.z + lp.z), new THREE.Quaternion(), new THREE.Vector3(W * 0.995, H * 0.995, L * 0.995));
    }
    function stackHeight(loc) { return Math.ceil(loc.stock / loc.lay.per) * loc.a.dims[1] + 0.144; }
    function makeLoadedPallet(a, n, wrapped = false) {
      const g = new THREE.Group();
      const pm = palletFit ? palletFit.clone(true) : new THREE.Mesh(palGeo, palMat);
      g.add(pm);
      const lay = stackLayout(a, 1.25);
      for (let i = 0; i < Math.min(n, lay.max); i++) {
        const m = cartonMesh(a);
        const lp = lay.pos(i);
        m.position.set(lp.x, 0.144 + lp.y, lp.z);
        m.scale.set(a.dims[2], a.dims[1], a.dims[0]);
        g.add(m);
      }
      if (wrapped) {
        const h = Math.ceil(Math.min(n, lay.max) / lay.per) * a.dims[1];
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.82, h + 0.02, 1.22), new THREE.MeshStandardMaterial({ color: 0xe6eef8, transparent: true, opacity: 0.25, roughness: 0.15, depthWrite: false }));
        f.position.y = 0.144 + h / 2; g.add(f);
        ctx.track(f.geometry); ctx.track(f.material);
      }
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return g;
    }

    drawDevice();
    updateObjective();
    onProgress && onProgress(1, 'fertig');
    const mission = ctx.mission({ targetTime: 480, expectedLines: 9 });

    return {
      spawn: SPOTS.spawn,
      hints: [['WASD', 'gehen'], ['Klick', 'scannen / nehmen'], ['F', 'Hubwagen'], ['Leertaste', 'Fehlmenge'], ['Tab', 'MDE groß'], ['C', 'bücken'], ['P', 'Pause']],
      briefing: {
        title: 'Lager 02 · Großhandel Nordstern',
        subtitle: 'Palettenregallager · Pick-by-Scan mit MDE · chaotische Lagerhaltung',
        blocks: [
          { p: 'Willkommen bei **Nordstern**, einem Großhändler für Getränke, Lebensmittel und Haushaltswaren. Hier werden ganze **Kartons** für Hotels, Kioske und Märkte kommissioniert – auf eine **Europalette**, die du mit dem **Hubwagen** mitnimmst.' },
          { h: 'Dein Auftrag' },
          { list: [
            'Hol dir an der **MDE-Ladestation** (Ostwand, beim Büro) ein Scanner-Terminal.',
            'Nimm den **Hubwagen** mit der leeren Palette (Taste **F**).',
            'Das **MDE** zeigt dir jede Position: Geh hin und **scanne das gelbe Platzetikett** (▼) an der Traverse.',
            'Nimm die angezeigte Anzahl **Kartons** – sie landen direkt auf deiner Palette. Das MDE zählt mit.',
            'Ist ein Platz leer, melde die **Fehlmenge** (Leertaste). Zum Schluss: Palette zum **Warenausgang WA 2** bringen und das Etikett scannen.',
          ] },
          { callout: '**Achtung Staplerverkehr!** Bleib möglichst auf dem **grünen Gehweg**, quere Fahrwege am Zebrastreifen und tritt nie vor einen fahrenden Stapler.' },
          { p: 'Hier hat kein Artikel einen festen Platz (**chaotische Lagerhaltung**) – ohne MDE wärst du verloren. Die türkisen **i-Punkte** erklären die Technik.' },
        ],
      },
      start() {
        mission.start();
        audio.ambient('hall');
        updateObjective();
        ui.toast('Tipp: Die **MDE-Ladestation** ist rechts an der Wand, direkt neben dem Büro.', 'info', 5000);
      },
      async afterBuild() {
        captureEnvironment(ctx, new THREE.Vector3(-3, 3.2, 1.5), { intensity: 0.8 });
      },
      pauseBlocks: () => [{ p: state.hasMDE ? `Auftrag **${ORDER.no}** · ${posDone()} von ${posTotal} Positionen erledigt · ${state.cartonsOn} Kartons geladen` : 'Noch kein MDE geholt.' }],
      quiz: QUIZ,
      dispose() {
        input.removeEventListener('cart', onCart);
        input.removeEventListener('device', onDevice);
        input.removeEventListener('confirm', onConfirm);
        engine.removeEventListener('xrstart', onXR); engine.removeEventListener('xrend', onXR); input.removeEventListener('controllerconnected', onXR);
        engine.removeEventListener('quality', updatePalletLOD);
        player.removeEventListener('attach', updateObjective); player.removeEventListener('detach', updateObjective);
        for (const v of vehicles) v.dispose();
        scanner.group.removeFromParent();
        wrist.removeFromParent();
      },
    };
  },
};

// ------------------------------------------------------------------ Bauteile
function bumpLevel(code) { const [g, p] = code.split('-'); return `${g}-${p}-1`; }

/** Modell so drehen, dass seine "Front" (laut Manifest) in die gewünschte Richtung zeigt */
function orientedModel(assets, id, want, fallback) {
  const tpl = assets.templates.get(id);
  const holder = new THREE.Group();
  if (!tpl) { const f = fallback(); holder.add(f); return { obj: holder, forkCenter: 0.75 }; }
  const m = assets.get(id);
  const info = assets.info(id) || {};
  const rot = { '+Z': 0, '-Z': Math.PI, '+X': -Math.PI / 2, '-X': Math.PI / 2 };
  m.rotation.y = (rot[info.front] ?? 0) + (want === '-Z' ? Math.PI : 0);
  holder.add(m);
  const b = new THREE.Box3().setFromObject(holder);
  return { obj: holder, forkCenter: Math.max(0.5, -b.min.z - 0.65), box: b };
}

function fallbackJack(ctx) {
  const g = new THREE.Group();
  const red = ctx.mat.basic(0xc0392b, 0.5, 0.4), dark = ctx.mat.basic(0x222222, 0.6, 0.2);
  g.add(mergeToMesh([boxGeo(0.16, 0.06, 1.15, -0.2, 0.05, -0.75), boxGeo(0.16, 0.06, 1.15, 0.2, 0.05, -0.75)], dark));
  g.add(mergeToMesh([boxGeo(0.6, 0.35, 0.3, 0, 0.25, 0), boxGeo(0.06, 1.0, 0.06, 0, 0.8, 0.12)], red));
  return g;
}

function makeScanner(ctx) {
  const { assets, mat } = ctx;
  const group = new THREE.Group();
  const nose = new THREE.Object3D();
  const tpl = assets.templates.get('scanner_handheld');
  if (tpl) {
    const m = assets.get('scanner_handheld');
    const holder = new THREE.Group(); holder.add(m);
    const s = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    // längste horizontale Achse nach vorne (−Z)
    if (s.x > s.z) m.rotation.y = Math.PI / 2;
    m.rotation.y += Math.PI * (ctx.scannerFlip ? 1 : 0);
    const k = 0.2 / Math.max(s.x, s.y, s.z);
    holder.scale.setScalar(k);
    holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(holder);
    const c = b.getCenter(new THREE.Vector3());
    holder.position.sub(c);
    group.add(holder);
    nose.position.set(0, (b.max.y - c.y) * 0.55, b.min.z - c.z);
  } else {
    const yel = mat.basic(0xf2b705, 0.5, 0.1), blk = mat.basic(0x1d1d1f, 0.6, 0.1);
    group.add(mergeToMesh([boxGeo(0.06, 0.05, 0.17, 0, 0.02, 0)], yel));
    group.add(mergeToMesh([boxGeo(0.045, 0.11, 0.05, 0, -0.06, 0.05), boxGeo(0.065, 0.055, 0.03, 0, 0.02, -0.095)], blk));
    nose.position.set(0, 0.02, -0.11);
  }
  group.add(nose);
  group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  group.userData.noEnvCapture = true;
  return { group, nose };
}

function makeMDEStation(ctx) {
  const { mat, assets } = ctx;
  const g = new THREE.Group();
  const dark = mat.basic(0x2b3138, 0.5, 0.4);
  g.add(mergeToMesh([boxGeo(1.0, 0.04, 0.32, 0, 0.92, 0.16), boxGeo(1.0, 0.5, 0.03, 0, 1.15, 0.015), boxGeo(0.04, 0.5, 0.32, -0.5, 1.15, 0.16), boxGeo(0.04, 0.5, 0.32, 0.5, 1.15, 0.16)], dark));
  const cradles = [];
  const units = [];
  const tpl = assets.templates.get('scanner_handheld');
  for (let i = 0; i < 3; i++) {
    const x = -0.26 + i * 0.26;
    const cr = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.16), mat.basic(0x111417, 0.6, 0.2));
    cr.position.set(x, 0.97, 0.16); g.add(cr); cradles.push(cr);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.01), mat.emissive(i === 0 ? 0x22ff88 : 0x22ff88, 3));
    led.position.set(x + 0.04, 0.985, 0.245); g.add(led);
    let u;
    if (tpl) {
      u = assets.get('scanner_handheld');
      const holder = new THREE.Group(); holder.add(u);
      const s = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
      if (s.x > s.z) u.rotation.y = Math.PI / 2;
      groundCenter(u);
      holder.scale.setScalar(0.19 / Math.max(s.x, s.y, s.z));
      holder.position.set(x, 1.0, 0.16);
      holder.rotation.x = -0.25;
      g.add(holder); units.push(holder);
    } else {
      u = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.17), mat.basic(0xf2b705, 0.5, 0.1));
      u.position.set(x, 1.03, 0.16); g.add(u); units.push(u);
    }
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return { group: g, take() { const u = units.find(x => x.visible); if (u) u.visible = false; } };
}

function buildDock(ctx, d, footprints) {
  const { mat, root } = ctx;
  const z = ctx.hallD ?? 13;
  const W = 3.0, H = 3.6;
  if (!d.open) {
    // geschlossenes Sektionaltor
    const c = makeCanvas(512, 640), g = c.getContext('2d');
    g.fillStyle = '#c9ced4'; g.fillRect(0, 0, 512, 640);
    for (let y = 0; y < 640; y += 128) {
      const gr = g.createLinearGradient(0, y, 0, y + 128);
      gr.addColorStop(0, '#dde1e6'); gr.addColorStop(0.9, '#b9bfc6'); gr.addColorStop(1, '#8e959c');
      g.fillStyle = gr; g.fillRect(0, y, 512, 126);
      for (let x = 0; x < 512; x += 32) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, y, 2, 126); }
    }
    // Sichtfenster
    for (let i = 0; i < 4; i++) { g.fillStyle = '#7f98ad'; roundRect(g, 40 + i * 116, 290, 84, 44, 6); g.fill(); g.strokeStyle = '#444'; g.lineWidth = 3; g.stroke(); }
    const door = signMesh(ctx, c, W, H);
    door.position.set(d.x, H / 2, 13 - 0.17); door.rotation.y = Math.PI;
    root.add(door);
  } else {
    // offenes Tor: Torblatt oben aufgerollt, draußen Tageslicht mit Lkw-Auflieger
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, H + 0.4), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: outsideTexture(), emissiveIntensity: 1.8 }));
    outside.position.set(d.x, H / 2, 13 + 1.6); outside.rotation.y = Math.PI;
    root.add(outside);
    // Auflieger-Heck (dunkel) + Ladebrücke
    root.add(mergeToMesh([boxGeo(2.5, 2.7, 0.2, d.x, 1.35 + 1.25, 13 + 0.9)], mat.basic(0x30363d, 0.6, 0.4), { cast: false }));
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 1.0), mat.pbr('metal_galvanized', { repeat: [2, 1], fallbackColor: 0x9aa0a6, tag: 'l2plate' }));
    plate.position.set(d.x, 0.02, 13 - 0.25); root.add(plate);
    const roll = new THREE.Mesh(new THREE.BoxGeometry(W, 0.5, 0.25), mat.basic(0xb9bfc6, 0.4, 0.5));
    roll.position.set(d.x, H - 0.25, 13 - 0.3); root.add(roll);
    // heller Fleck auf dem Boden
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64); rg.addColorStop(0, 'rgba(255,245,225,0.9)'); rg.addColorStop(1, 'rgba(255,245,225,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    const tex = ctx.track(new THREE.CanvasTexture(c));
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    patch.rotation.x = -Math.PI / 2; patch.position.set(d.x - 0.4, 0.006, 13 - 2.0); patch.userData.noEnvCapture = true;
    root.add(patch);
  }
  // Torzarge & Puffer
  root.add(mergeToMesh([boxGeo(0.18, H, 0.2, d.x - W / 2 - 0.09, H / 2, 13 - 0.22), boxGeo(0.18, H, 0.2, d.x + W / 2 + 0.09, H / 2, 13 - 0.22), boxGeo(W + 0.36, 0.18, 0.2, d.x, H + 0.09, 13 - 0.22)], ctx.mat.basic(0xf2c21b, 0.5, 0.3)));
  footprints.push({ x: d.x, z: 13 - 0.3, w: W + 0.4, d: 0.4, s: 0.3 });
}

function makeWAPost(ctx, text) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.6, 12), ctx.mat.basic(0xf2c21b, 0.45, 0.3));
  pole.position.y = 0.8; g.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.06, 16), ctx.mat.basic(0x333333, 0.6, 0.3));
  base.position.y = 0.03; g.add(base);
  const c = makeCanvas(512, 320), cg = c.getContext('2d');
  cg.fillStyle = '#ffffff'; cg.fillRect(0, 0, 512, 320);
  cg.fillStyle = '#f08a24'; cg.fillRect(0, 0, 512, 70);
  cg.fillStyle = '#111'; cg.font = `900 54px ${FONT}`; cg.textAlign = 'center'; cg.textBaseline = 'middle';
  cg.fillText('WARENAUSGANG', 256, 38);
  cg.font = `900 92px ${FONT}`; cg.fillText(text, 256, 140);
  drawCode128(cg, text.replace(' ', ''), 56, 200, 400, 100);
  const board = signMesh(ctx, c, 0.48, 0.3);
  board.position.set(0, 1.42, 0.03);
  g.add(board);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.03), ctx.mat.basic(0x222222, 0.6, 0.2));
  back.position.set(0, 1.42, 0.0); g.add(back);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeWarningSign(ctx) {
  const g = new THREE.Group();
  const c = makeCanvas(512, 600), cg = c.getContext('2d');
  cg.fillStyle = '#ffffff'; cg.fillRect(0, 0, 512, 600);
  cg.fillStyle = '#f2c21b'; cg.strokeStyle = '#111'; cg.lineWidth = 22; cg.lineJoin = 'round';
  cg.beginPath(); cg.moveTo(256, 40); cg.lineTo(470, 400); cg.lineTo(42, 400); cg.closePath(); cg.fill(); cg.stroke();
  // Stapler-Piktogramm
  cg.fillStyle = '#111';
  cg.fillRect(170, 250, 120, 70); cg.fillRect(290, 180, 14, 140); cg.fillRect(304, 300, 70, 12); cg.fillRect(200, 210, 60, 44);
  cg.beginPath(); cg.arc(195, 330, 22, 0, 7); cg.fill(); cg.beginPath(); cg.arc(270, 330, 22, 0, 7); cg.fill();
  cg.font = `900 58px ${FONT}`; cg.textAlign = 'center'; cg.fillText('Achtung', 256, 470); cg.font = `800 46px ${FONT}`; cg.fillText('Staplerverkehr', 256, 540);
  const s = signMesh(ctx, c, 0.6, 0.7);
  s.position.set(0, 1.75, 0.012); g.add(s);
  const s2 = s.clone(); s2.position.z = -0.012; s2.rotation.y = Math.PI; g.add(s2);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.02), ctx.mat.basic(0xdddddd, 0.5, 0.4));
  plate.position.y = 1.75; g.add(plate);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.45, 10), ctx.mat.basic(0x9aa0a6, 0.4, 0.8));
  pole.position.y = 0.72; g.add(pole);
  return g;
}

function decal(ctx, canvas, x, z, w, h, ry = 0) {
  const tex = ctx.track(new THREE.CanvasTexture(canvas)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.65, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = ry;
  m.position.set(x, 0.005, z);
  m.receiveShadow = true;
  ctx.track(m.geometry); ctx.track(m.material);
  ctx.root.add(m);
  return m;
}

function pedestrianCanvas() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(245,245,240,0.92)';
  g.beginPath(); g.arc(128, 52, 24, 0, 7); g.fill();
  g.lineWidth = 26; g.lineCap = 'round'; g.strokeStyle = 'rgba(245,245,240,0.92)';
  g.beginPath(); g.moveTo(128, 88); g.lineTo(122, 150); g.stroke();
  g.beginPath(); g.moveTo(122, 150); g.lineTo(90, 220); g.moveTo(122, 150); g.lineTo(160, 215); g.stroke();
  g.beginPath(); g.moveTo(126, 100); g.lineTo(84, 140); g.moveTo(126, 100); g.lineTo(170, 128); g.stroke();
  return c;
}

function floorNumberCanvas(text) {
  const c = makeCanvas(512, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(240,240,232,0.85)'; g.font = `900 190px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 138, 500);
  return c;
}

const QUIZ = [
  { q: 'Wozu scannst du bei Nordstern das Platzetikett, bevor du Kartons nimmst?', options: ['Damit das System prüft, ob du am richtigen Lagerplatz bist', 'Damit die Arbeitszeit erfasst wird', 'Damit der Stapler weiß, wo du bist', 'Damit das Etikett nicht verloren geht'], correct: 0, explain: 'Der Platz-Scan validiert den Lagerplatz. Ein falscher Platz wird sofort erkannt – so entsteht der Pickfehler gar nicht erst.' },
  { q: 'Was bedeutet „chaotische Lagerhaltung“?', options: ['Im Lager herrscht Unordnung', 'Neue Ware kommt auf einen freien Platz; das Lagerverwaltungssystem merkt sich, wo sie liegt', 'Jeder Artikel hat seinen festen Platz', 'Die Artikel werden alphabetisch sortiert'], correct: 1, explain: 'Beim Freiplatzsystem wird jeder freie Platz genutzt. Das funktioniert nur, weil das LVS jeden Platz kennt.' },
  { q: 'Die Lagerplatzadresse 02-07-0 bedeutet bei Nordstern …', options: ['Halle 2, Tor 7, Rampe 0', 'Gang 02, Platz 07, Ebene 0 (Bodenebene)', 'Regal 2, Ebene 7, Fach 0', 'Auftrag 2, Position 7, Menge 0'], correct: 1, explain: 'Gang – Platz – Ebene. Ebene 0 ist der Kommissionierplatz am Boden, darüber liegen die Reserveplätze.' },
  { q: 'Warum schickt dich das MDE zuerst zu den schweren Kartons?', options: ['Weil sie am teuersten sind', 'Damit schwere Ware unten auf der Palette liegt (Ladungssicherung)', 'Weil sie am weitesten weg stehen', 'Damit du dich zuerst aufwärmst'], correct: 1, explain: 'Schwer unten, leicht oben: Das ist das Packschema. Es schützt die Ware und hält die Palette stabil.' },
  { q: 'Was ist ein Nachschubauftrag?', options: ['Eine neue Bestellung beim Lieferanten', 'Das Umlagern einer vollen Palette vom Reserveplatz auf den Kommissionierplatz', 'Eine Nachlieferung an den Kunden', 'Das Zurückbuchen einer Retoure'], correct: 1, explain: 'Wird der Kommissionierplatz leer, bringt ein Stapler Ware vom Reserveplatz – meist direkt darüber.' },
  { q: 'Wie verhältst du dich richtig im Staplerverkehr?', options: ['Der Stapler muss mir immer ausweichen', 'Gehwege nutzen, an Zebrastreifen queren und Blickkontakt mit dem Fahrer suchen', 'Schnell vor dem Stapler über den Fahrweg laufen', 'Hinter einem rückwärts fahrenden Stapler hergehen'], correct: 1, explain: 'Stapler haben lange Bremswege und tote Winkel. Gehwege, Zebrastreifen und Blickkontakt schützen dich.' },
];
