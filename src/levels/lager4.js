// LAGER 04 – Robotik-Center „Orbit“
// Ware-zur-Person · mobile Roboter (AMR) bringen Regal-Pods zur Pick-Station · Putwall · WMS/WCS steuert alles
import * as THREE from 'three';
import { buildHall, setupLighting, captureEnvironment, bakeFloorAO, floorLines, boxGeo, mergeToMesh } from '../core/env.js';
import { Atlas, atlasInstancedMaterial, signMesh, windowMesh } from '../core/builders.js';
import { makeCanvas, signCanvas, FONT, MONO, drawEAN, drawIcon } from '../core/canvas.js';
import { Interaction, fitObject, roundRect } from '../core/interaction.js';
import { fmtTime, fmtNum, loadResults } from '../sim/mission.js';
import { groundCenter } from '../core/assets.js';
import { LEVELS } from './registry.js';
import { makeProducts, productCanvas, fiducialCanvas, RNG } from './lager4/catalog.js';
import { Fleet, GRID, cxw, czw, POD, rowY, binLabel, FIELD, fallbackRobot, PRESENT, CHARGER_ROWS } from './lager4/fleet.js';
import { buildFence, buildFieldFloor, chargerMesh, buildStationFrame, buildLightPointer, buildPutWall, rollerConveyor } from './lager4/station.js';

const HALL = { w: 36, d: 24, h: 8 };
const OX = 8.95;                                  // Zaunlinie Ost (Stationsöffnung)
const OW = 1.24;                                  // Breite der Öffnung
const STAND = { x: 9.78, z: 0 };                  // Standplatz des Pickers
const PX = cxw(PRESENT.i), PZ = czw(PRESENT.j);   // Pod-Mitte an der Station
const SPAWN = { x: 13.0, z: 9.4, yaw: 0.3 };
const SCREEN = { x: 9.3, y: 1.47, z: 1.02, w: 0.8, h: 0.5 };
const FENCE = { minX: -15.0, maxX: OX, minZ: -8.3, maxZ: 8.3 };

export default {
  async build(ctx, { onProgress } = {}) {
    const { engine, mat, assets, ui, audio, player, interaction, root, input } = ctx;
    const hand = interaction.hand;
    const rnd = RNG(4242);
    const tmpV = new THREE.Vector3();

    // ---------- Modelle
    const modelIds = ['amr_bot', 'scanner_stand', 'monitor_office', 'terminal_rugged', 'work_table', 'lockers', 'first_aid', 'extinguisher', 'trash_bin',
      'pallet_load_a', 'pallet_load_wrapped', 'pallet_load_mixed', 'stacker', 'p_markers', 'p_cookies', 'p_juice', 'p_glovebox', 'p_gloves', 'p_bulb', 'p_pliers', 'p_screwdriver', 'sign_cone'];
    await assets.preload(modelIds, (p, id) => onProgress && onProgress(p * 0.45, 'Modell: ' + id));

    // ---------- Halle
    const floorMat = mat.pbr('floor_concrete_clean', { repeat: [HALL.w / 4, HALL.d / 4], ao: false, color: 0x9aa2ad, roughness: 0.42, fallbackColor: 0x30353c, fallbackRoughness: 0.4, tag: 'l4floor' });
    const wallMat = mat.pbr('wall_panel_metal', { repeat: [1, 1], color: 0x8e98a5, fallbackColor: 0x5b636d, metalness: 0.25, tag: 'l4wall' });
    const lowerMat = mat.pbr('metal_painted', { repeat: [1, 1], color: 0x3e4651, fallbackColor: 0x3a424c, metalness: 0.2, tag: 'l4lower' });
    const ceilMat = mat.pbr('wall_panel_metal', { repeat: [HALL.w / 3, HALL.d / 3], color: 0x4d5560, fallbackColor: 0x3a4048, metalness: 0.25, tag: 'l4ceil' });
    const hall = buildHall(ctx, {
      ...HALL, style: 'robot', floor: floorMat, wall: wallMat, wallTile: 4, ceiling: ceilMat, wallLower: lowerMat, wallLowerH: 1.4,
      trussSpacing: 6, trussMat: mat.basic(0x3b434d, 0.5, 0.7), doors: [{ side: 's', at: 13, w: 3.2, h: 3.4 }, { side: 'n', at: 14.5, w: 4, h: 4.2 }],
    });
    // Hallentore (Sektionaltor-Optik)
    const doorTex = (() => {
      const c = makeCanvas(512, 512), g = c.getContext('2d');
      g.fillStyle = '#9aa3ad'; g.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 512; y += 64) { g.fillStyle = '#7f8893'; g.fillRect(0, y + 58, 512, 6); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, y, 512, 8); }
      g.fillStyle = '#c7d2fe'; for (let x = 40; x < 512; x += 110) g.fillRect(x, 140, 70, 34);
      return c;
    })();
    const d1 = signMesh(ctx, doorTex, 3.2, 3.4); d1.position.set(13, 1.7, HALL.d / 2 - 0.16); d1.rotation.y = Math.PI; root.add(d1);
    const d2 = signMesh(ctx, doorTex, 4, 4.2); d2.position.set(14.5, 2.1, -HALL.d / 2 + 0.16); root.add(d2);
    // Oberlichter Nordwand
    for (let x = -14; x <= 8; x += 5.5) {
      if (Math.abs(x + 3) < 1) continue;   // hinter der Wandschrift (x = -3) kein Fenster – es schien je nach Blickwinkel durch
      const w = windowMesh(ctx, { w: 3.6, h: 1.1, glow: 0.95, cols: 6, rows: 1, frameColor: 0x30363f });
      w.position.set(x, 6.4, -HALL.d / 2 + 0.16); root.add(w);
    }
    // Leuchtband an den Wänden (Akzent)
    const stripMat = mat.emissive(0x22d3ee, 2.2);
    root.add(mergeToMesh([
      boxGeo(HALL.w - 0.4, 0.04, 0.03, 0, 4.2, -HALL.d / 2 + 0.17), boxGeo(HALL.w - 0.4, 0.04, 0.03, 0, 4.2, HALL.d / 2 - 0.17),
      boxGeo(0.03, 0.04, HALL.d - 0.4, -HALL.w / 2 + 0.17, 4.2, 0), boxGeo(0.03, 0.04, HALL.d - 0.4, HALL.w / 2 - 0.17, 4.2, 0),
    ], stripMat, { cast: false }));
    // Wandschrift
    const brand = signMesh(ctx, signCanvas('ORBIT', { sub: 'Robotik-Fulfillment-Center', bg: '#0b1220', fg: '#e2e8f0', w: 1024, h: 320 }), 6.4, 2.0, { emissive: 0.5 });
    brand.position.set(-3, 5.9, -HALL.d / 2 + 0.17); root.add(brand);

    onProgress && onProgress(0.5, 'Roboterfeld aufbauen …');
    // ---------- Sortiment & Atlanten
    const products = makeProducts();
    const prodAtlas = new Atlas(ctx, { size: 2048, cellW: 128, cellH: 128 });
    const prodCanvas = new Map();
    for (const p of products) { const c = productCanvas(p); prodCanvas.set(p.id, c); p.uv = prodAtlas.add(c); }
    const labelAtlas = new Atlas(ctx, { size: 1024, cellW: 256, cellH: 64 });
    const podLabelUV = new Map();
    const podLabel = no => {
      if (podLabelUV.has(no)) return podLabelUV.get(no);
      const c = makeCanvas(512, 128), g = c.getContext('2d');
      g.fillStyle = '#f8fafc'; g.fillRect(0, 0, 512, 128);
      g.fillStyle = '#0f172a'; g.font = `900 66px ${FONT}`; g.textBaseline = 'middle'; g.fillText('POD ' + no, 18, 66);
      g.fillStyle = '#111'; for (let i = 0; i < 26; i++) g.fillRect(330 + i * 6.5, 22, (i * 7 % 3) + 1.5, 84);
      const uv = labelAtlas.add(c); podLabelUV.set(no, uv); return uv;
    };

    // Artikel-Geometrie: Vorderseite zeigt die Packung, Seiten einen Farbstreifen
    const itemGeo = new THREE.BoxGeometry(1, 1, 1);
    { const uv = itemGeo.attributes.uv; for (let f = 0; f < 6; f++) { if (f === 4) continue; for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, 0.008 + uv.getX(k) * 0.03, 0.3 + uv.getY(k) * 0.3); } } }
    const labelGeo = new THREE.PlaneGeometry(0.3, 0.075);
    ctx.track(itemGeo); ctx.track(labelGeo);
    const itemMat = atlasInstancedMaterial(prodAtlas.texture, { roughness: 0.55 }); ctx.track(itemMat);
    const labelMat = atlasInstancedMaterial(labelAtlas.texture, { roughness: 0.5 }); ctx.track(labelMat);
    // Stofffächer: reine Instanzfarbe (Gelb) + Gewebestruktur aus der Normal-/ARM-Map
    const fabricMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    ctx.track(fabricMat);
    for (const [file, prop] of [['normal', 'normalMap'], ['arm', 'roughnessMap']]) {
      const e = mat._load(`${mat.base}fabric_canvas/${file}.webp`, false);
      e.promise.then(tex => { if (!tex) return; const t = tex.clone(); t.repeat.set(2, 2); t.needsUpdate = true; ctx.track(t); fabricMat[prop] = t; if (prop === 'normalMap') fabricMat.normalScale.set(0.8, 0.8); fabricMat.needsUpdate = true; });
    }
    const sideMat = mat.pbr('fabric_canvas', { color: 0xc4cbd5, repeat: [1, 1], fallbackColor: 0x8a94a3, metalness: 0, side: THREE.DoubleSide, tag: 'l4side' });
    const frameMat = mat.basic(0x5a626e, 0.38, 0.6);

    // Roboter-Vorlage (Front = +Z, passt unter den Pod)
    const robotTpl = (() => {
      const t = assets.templates.get('amr_bot');
      const info = assets.info('amr_bot');
      const inner = t ? t.clone(true) : fallbackRobot();
      if (t) inner.rotation.y = ({ '+Z': 0, '-Z': Math.PI, '+X': -Math.PI / 2, '-X': Math.PI / 2 })[info && info.front] ?? 0;
      const wrap = new THREE.Group(); wrap.add(inner);
      const s = new THREE.Box3().setFromObject(wrap).getSize(new THREE.Vector3());
      inner.scale.multiplyScalar(Math.min(0.84 / Math.max(s.x, s.z), 0.29 / s.y, 2));
      groundCenter(inner);
      return wrap;
    })();
    // einfache Variante für weit entfernte Roboter (spart ~20 000 Dreiecke je Roboter)
    const robotLow = (() => {
      if (!assets.templates.get('amr_bot')) return null;
      const target = new THREE.Box3().setFromObject(robotTpl).getSize(new THREE.Vector3());
      const inner = fallbackRobot();
      const s = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3());
      inner.scale.set(target.x / s.x, target.y / s.y, target.z / s.z);
      inner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.35); ctx.track(o.material); ctx.track(o.geometry); } });
      const wrap = new THREE.Group(); wrap.add(inner); groundCenter(inner);
      return wrap;
    })();

    // ---------- Flotte
    const fleet = new Fleet(ctx, {
      seed: 777, podCount: 40, robotCount: 9, products, robotTemplate: robotTpl, robotTemplateLow: robotLow, nearRobots: 5, nearDist: 11,
      itemGeo, itemMat, labelGeo, labelMat, fabricMat, frameMat, sideMat,
      productUV: p => p.uv, podLabelUV: podLabel,
    });

    // Boden im Feld, Zaun, Ladestationen
    buildFieldFloor(ctx, fiducialCanvas(11), FIELD);
    buildFence(ctx, [
      { x1: FENCE.minX, z1: FENCE.minZ, x2: FENCE.maxX, z2: FENCE.minZ }, { x1: FENCE.minX, z1: FENCE.maxZ, x2: FENCE.maxX, z2: FENCE.maxZ },
      { x1: FENCE.minX, z1: FENCE.minZ, x2: FENCE.minX, z2: FENCE.maxZ },
      { x1: OX, z1: FENCE.minZ, x2: OX, z2: -OW / 2 - 0.12 }, { x1: OX, z1: OW / 2 + 0.12, x2: OX, z2: FENCE.maxZ },
    ]);
    const footprints = [];
    const chargerLeds = [];
    for (const j of CHARGER_ROWS) {
      const ch = chargerMesh(ctx);
      ch.userData.led.material = ch.userData.led.material.clone(); ctx.track(ch.userData.led.material);
      ch.position.set(cxw(0) - 0.42, 0, czw(j));
      root.add(ch);
      chargerLeds.push(ch.userData.led);
      footprints.push({ x: ch.position.x, z: ch.position.z, w: 0.5, d: 0.6, s: 0.4, blur: 0.25 });
    }

    // ---------- Station 3 (aktiv) und Station 4 (geschlossen)
    const st = buildStationFrame(ctx, { ox: OX, oz: 0, ow: OW, title: 'STATION 3' });
    buildStationFrame(ctx, { ox: OX, oz: czw(10), ow: OW, title: 'STATION 4', closed: true });
    st.setLight('wait');
    // Stehmatte + Podest
    const matTex = mat.pbr('rubber_mat', { repeat: [2, 2], color: 0x9aa3ad, fallbackColor: 0x1d2228, metalness: 0, tag: 'l4mat' });
    const podest = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 1.7), matTex);
    podest.position.set(STAND.x + 0.15, 0.02, STAND.z); podest.receiveShadow = true; root.add(podest);
    const edge = new THREE.MeshStandardMaterial({ map: mat.hazardTexture(), roughness: 0.6 });
    const edges = mergeToMesh([boxGeo(1.52, 0.045, 0.05, STAND.x + 0.15, 0.022, STAND.z - 0.875), boxGeo(1.52, 0.045, 0.05, STAND.x + 0.15, 0.022, STAND.z + 0.875)], edge, { cast: false });
    root.add(edges);
    // Bodenschrift „STATION 3“
    const fl = makeCanvas(512, 128), fg = fl.getContext('2d');
    fg.fillStyle = 'rgba(0,0,0,0)'; fg.clearRect(0, 0, 512, 128);
    fg.fillStyle = 'rgba(226,232,240,0.85)'; fg.font = `900 86px ${FONT}`; fg.textAlign = 'center'; fg.textBaseline = 'middle'; fg.fillText('STATION 3', 256, 68);
    const flTex = ctx.track(new THREE.CanvasTexture(fl)); flTex.colorSpace = THREE.SRGBColorSpace;
    const flMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshStandardMaterial({ map: flTex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    flMesh.rotation.x = -Math.PI / 2; flMesh.rotation.z = Math.PI / 2; flMesh.position.set(11.1, 0.004, 0); root.add(flMesh);

    // Bildschirm (Touch) auf Säule
    ui.device.resize(1024, 640);
    const scr = new THREE.Group();
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(SCREEN.w + 0.05, SCREEN.h + 0.05, 0.035), mat.basic(0x111418, 0.35, 0.4));
    bezel.position.z = -0.02;
    const screenMat = new THREE.MeshBasicMaterial({ map: ui.device.texture, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), screenMat);
    scr.add(bezel, screen);
    const toPlayer = Math.atan2(STAND.x - SCREEN.x, STAND.z - SCREEN.z);
    scr.position.set(SCREEN.x, SCREEN.y, SCREEN.z); scr.rotation.set(0, toPlayer, 0, 'YXZ'); scr.rotateX(-0.12);
    root.add(scr);
    const pole = mergeToMesh([boxGeo(0.07, SCREEN.y - 0.2, 0.07, SCREEN.x - 0.02, (SCREEN.y - 0.2) / 2, SCREEN.z + 0.05), boxGeo(0.45, 0.03, 0.45, SCREEN.x - 0.02, 0.015, SCREEN.z + 0.05)], mat.basic(0x2b3038, 0.4, 0.7));
    root.add(pole);
    player.addBox(SCREEN.x - 0.25, SCREEN.z - 0.2, SCREEN.x + 0.22, SCREEN.z + 0.3, 'screen');
    // Scanner auf Ablage
    const shelf = mergeToMesh([boxGeo(0.4, 0.03, 0.3, SCREEN.x + 0.05, 1.0, SCREEN.z - 0.38), boxGeo(0.04, 1.0, 0.04, SCREEN.x + 0.05, 0.5, SCREEN.z - 0.38)], mat.basic(0x2b3038, 0.4, 0.7));
    root.add(shelf);
    if (assets.templates.get('scanner_stand')) {
      const sc = assets.get('scanner_stand'); const s = assets.size('scanner_stand');
      sc.scale.setScalar(Math.min(1, 0.28 / Math.max(s.y, 0.01)));
      sc.position.set(SCREEN.x + 0.05, 1.015, SCREEN.z - 0.38); sc.rotation.y = Math.PI / 2; root.add(sc);
    }

    // Lichtzeiger
    const pointer = buildLightPointer(ctx, new THREE.Vector3(OX + 0.22, 2.66, 0));

    // ---------- Aufträge & Pod-Besuche planen
    const orderNos = ['WEB-58213', 'WEB-58219', 'WEB-58224', 'WEB-58230', 'WEB-58233', 'WEB-58241', 'WEB-58247', 'WEB-58252'];
    const customers = ['Weber, Köln', 'Yılmaz, Mainz', 'Schneider, Trier', 'Becker, Ulm', 'Nowak, Kassel', 'Fischer, Kiel', 'Haas, Passau', 'Klein, Saarlouis'];
    // Verfügbarkeit je Artikel (über alle Pod-Fächer)
    const avail = new Map();
    for (const pod of fleet.pods) for (let f = 0; f < 2; f++) for (let r = 0; r < POD.ROWS; r++) for (let c = 0; c < POD.COLS; c++) {
      const b = pod.bins[f][r][c]; if (!b.stock) continue;
      const a = avail.get(b.sku) || { pods: new Set(), max: 0 }; a.pods.add(pod); a.max = Math.max(a.max, b.stock); avail.set(b.sku, a);
    }
    const good = products.filter(p => avail.get(p) && avail.get(p).pods.size >= 2);
    const shuffled = good.slice().sort(() => rnd() - 0.5);
    const sizes = [3, 2, 4, 1, 3, 2, 3, 2];
    const orders = [];
    let pi = 0;
    for (let k = 0; k < 8; k++) {
      const lines = [];
      let units = 0;
      while (units < sizes[k]) {
        const p = shuffled[pi++ % shuffled.length];
        const qty = (units + 2 <= sizes[k] && avail.get(p).max >= 2 && rnd() < 0.3) ? 2 : 1;
        lines.push({ p, qty, put: 0 });
        units += qty;
      }
      orders.push({ k, no: orderNos[k], customer: customers[k], lines, done: false });
    }
    const allLines = [];
    orders.forEach((o, k) => o.lines.forEach(ln => allLines.push({ order: k, line: ln, p: ln.p, qty: ln.qty })));
    const TOTAL_UNITS = allLines.reduce((s, l) => s + l.qty, 0);

    const used = new Map();
    const binKey = (pod, f, r, c) => `${pod.k}|${f}|${r}|${c}`;
    function findBin(pod, f, p, qty, extraUse) {
      for (let r = 0; r < POD.ROWS; r++) for (let c = 0; c < POD.COLS; c++) {
        const b = pod.bins[f][r][c];
        if (b.sku !== p) continue;
        const k = binKey(pod, f, r, c);
        if (b.stock - (used.get(k) || 0) - (extraUse.get(k) || 0) >= qty) return { r, c, k };
      }
      return null;
    }
    const visits = [];
    const usedPods = new Set();
    let remaining = allLines.slice();
    while (remaining.length) {
      let best = null;
      for (const pod of fleet.pods) for (let f = 0; f < 2; f++) {
        if (usedPods.has(pod)) continue;   // jeder Pod nur einmal einplanen (sonst müsste er zweimal fahren)
        const extra = new Map(); const got = [];
        for (const ln of remaining) {
          const b = findBin(pod, f, ln.p, ln.qty, extra);
          if (b) { extra.set(b.k, (extra.get(b.k) || 0) + ln.qty); got.push({ ln, b }); }
        }
        if (!got.length) continue;
        const dist = Math.abs(pod.cell.i - PRESENT.i) + Math.abs(pod.cell.j - PRESENT.j);
        const score = Math.min(got.length, 2) * 10 - dist * 1.1 + rnd() * 0.5;
        if (!best || score > best.score) best = { pod, f, got: got.slice(0, 2), score };
      }
      if (!best && usedPods.size) { usedPods.clear(); continue; }   // notfalls Pods doch mehrfach verwenden
      if (!best) { console.warn('Lager 4: nicht alle Positionen planbar', remaining); break; }
      usedPods.add(best.pod);
      const v = { id: visits.length + 1, pod: best.pod, face: best.f, picks: [] };
      for (const { ln, b } of best.got) {
        used.set(b.k, (used.get(b.k) || 0) + ln.qty);
        v.picks.push({ ...ln, visit: v, r: b.r, c: b.c, k: b.k, done: false, taken: 0 });
        remaining = remaining.filter(x => x !== ln);
      }
      visits.push(v);
    }
    // Fehlteil (Bestandsdifferenz) in einem der ersten Pods vorbereiten
    let fehl = null;
    for (let vi = 1; vi < Math.min(visits.length, 5) && !fehl; vi++) {
      for (const pk of visits[vi].picks) {
        const sameBinUsers = visits.flatMap(v => v.picks).filter(x => x.k === pk.k).length;
        if (sameBinUsers > 1) continue;
        // Ersatz-Pod mit gleichem Artikel suchen (nicht in der Planung verwendet)
        let backup = null;
        for (const pod of fleet.pods) {
          if (pod === pk.visit.pod || visits.some(v => v.pod === pod)) continue;
          for (let f = 0; f < 2 && !backup; f++) { const b = findBin(pod, f, pk.p, pk.qty, new Map()); if (b) backup = { pod, f, ...b }; }
          if (backup) break;
        }
        if (backup) { fehl = { pick: pk, backup }; break; }
      }
    }
    if (fehl) {
      fehl.pick.fehlteil = true;
      fleet.emptyBin(fehl.pick.visit.pod, fehl.pick.visit.face, fehl.pick.r, fehl.pick.c);
    }
    fleet.futurePods = new Set([...visits.map(v => v.pod), ...(fehl ? [fehl.backup.pod] : [])]);
    { const placed = new Set(); visits.slice(0, 2).forEach(v => fleet.parkUnder(v.pod, placed)); }
    const TOTAL_LINES = allLines.length;

    // ---------- Putwall + Förderband
    const pw = buildPutWall(ctx, { x: 10.05, z: -1.32, cols: 4, rows: 2, slotW: 0.44, slotH: 0.4, depth: 0.5, y0: 0.72, orders });
    footprints.push({ x: 10.05, z: -1.57, w: 1.8, d: 0.55, s: 0.45, blur: 0.25 });
    const conveyorZ = -2.3;
    rollerConveyor(ctx, { x1: 9.0, x2: 15.4, z: conveyorZ, y: 0.76 });   // prozedural: ~4 000 statt 60 000 Dreiecke
    player.addBox(9.0, conveyorZ - 0.4, 15.4, conveyorZ + 0.4, 'conveyor');
    footprints.push({ x: 12.2, z: conveyorZ, w: 6.4, d: 0.7, s: 0.35, blur: 0.3 });
    // Trennwand Packerei mit Lamellenvorhang
    const partMat = mat.pbr('wall_panel_metal', { repeat: [2, 1], color: 0x4b5563, fallbackColor: 0x4b5563, metalness: 0.4, tag: 'l4part' });
    root.add(mergeToMesh([boxGeo(0.2, 3.2, 3.0, 15.6, 1.6, -4.3), boxGeo(0.2, 3.2, 1.6, 15.6, 1.6, -0.2), boxGeo(0.2, 2.0, 1.4, 15.6, 2.2, conveyorZ)], partMat));
    player.addBox(15.5, -5.8, 15.7, 0.6, 'partition');
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.15), new THREE.MeshStandardMaterial({ color: 0x9fb7c9, transparent: true, opacity: 0.35, roughness: 0.2, side: THREE.DoubleSide }));
    curtain.position.set(15.52, 0.62 + 0.6, conveyorZ); curtain.rotation.y = Math.PI / 2; root.add(curtain);
    const pk = signMesh(ctx, signCanvas('Packerei & Versand', { bg: '#0f172a', fg: '#e2e8f0', w: 768, h: 160 }), 1.6, 0.33);
    pk.position.set(15.48, 2.95, conveyorZ); pk.rotation.y = -Math.PI / 2; root.add(pk);

    // ---------- Leitstand-Anzeige über der Station (KPI + Live-Karte)
    const wallC = makeCanvas(1280, 400);
    const wallTex = ctx.track(new THREE.CanvasTexture(wallC)); wallTex.colorSpace = THREE.SRGBColorSpace; wallTex.anisotropy = 4;
    const vw = new THREE.Group();
    const vwPanel = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.5), new THREE.MeshBasicMaterial({ map: wallTex, toneMapped: false }));
    const vwBack = new THREE.Mesh(new THREE.BoxGeometry(4.95, 1.62, 0.08), mat.basic(0x0b0f14, 0.4, 0.5)); vwBack.position.z = -0.05;
    vw.add(vwBack, vwPanel);
    vw.position.set(OX - 0.05, 3.65, 0); vw.rotation.y = Math.PI / 2;
    root.add(vw);
    root.add(mergeToMesh([boxGeo(0.12, 4.4, 0.12, OX - 0.1, 2.2, -2.55), boxGeo(0.12, 4.4, 0.12, OX - 0.1, 2.2, 2.55)], mat.basic(0x2b3038, 0.4, 0.7)));

    // ---------- Leitstand-Tisch, Wareneingang & Deko
    const deco = [['work_table', 14.6, 4.6, -Math.PI / 2], ['lockers', 17.55, 9.0, -Math.PI / 2], ['trash_bin', 17.4, 6.9, -Math.PI / 2],
      ['pallet_load_a', 16.2, -9.6, 0.1], ['pallet_load_wrapped', 14.6, -9.8, -0.05], ['pallet_load_mixed', 16.3, -7.6, 0.2], ['stacker', 12.6, -9.9, Math.PI / 2], ['sign_cone', 11.6, -8.9, 0.3]];
    for (const [id, x, z, ry] of deco) {
      if (!assets.templates.get(id)) continue;
      const o = assets.get(id); o.position.set(x, 0, z); o.rotation.y = ry; root.add(o);
      const s = assets.size(id); const r = Math.max(s.x, s.z) / 2;
      player.addCircle(x, z, r * 0.8, id);
      footprints.push({ x, z, w: s.x * 0.9, d: s.z * 0.9, s: 0.4, blur: 0.25 });
    }
    if (assets.templates.get('work_table')) {
      const top = assets.size('work_table').y;
      for (const [dz, id] of [[-0.45, 'monitor_office'], [0.45, 'monitor_office'], [0, 'terminal_rugged']]) {
        if (!assets.templates.get(id)) continue;
        const m = assets.get(id); const s = assets.size(id);
        if (id === 'terminal_rugged') m.scale.setScalar(Math.min(1, 0.3 / Math.max(s.x, s.y)));
        m.position.set(14.75, top, 4.6 + dz); m.rotation.y = -Math.PI / 2 + (dz ? -Math.sign(dz) * 0.25 : 0); root.add(m);
      }
    }
    const ls = signMesh(ctx, signCanvas('Leitstand', { sub: 'Flottensteuerung · WMS / WCS', bg: '#0f172a', fg: '#e2e8f0', w: 768, h: 220 }), 1.5, 0.43, { emissive: 0.4 });
    ls.position.set(HALL.w / 2 - 0.18, 2.6, 4.6); ls.rotation.y = -Math.PI / 2; root.add(ls);
    const we = signMesh(ctx, signCanvas('Wareneingang', { sub: 'Einlagern (Stow) · Pods auffüllen', bg: '#0f172a', fg: '#e2e8f0', w: 768, h: 220 }), 1.6, 0.46, { emissive: 0.4 });
    we.position.set(14.5, 3.2, -HALL.d / 2 + 0.2); root.add(we);
    if (assets.templates.get('first_aid')) { const fa = assets.get('first_aid'); fa.position.set(HALL.w / 2 - 0.15, 1.35, 7.6); fa.rotation.y = -Math.PI / 2; root.add(fa); }
    if (assets.templates.get('extinguisher')) { const fe = assets.get('extinguisher'); fe.position.set(HALL.w / 2 - 0.35, 0, 8.3); fe.rotation.y = -Math.PI / 2; root.add(fe); player.addCircle(HALL.w / 2 - 0.35, 8.3, 0.2); }
    // Warnschilder am Zaun
    const warn = makeCanvas(512, 384), wg = warn.getContext('2d');
    wg.fillStyle = '#f8fafc'; wg.fillRect(0, 0, 512, 384);
    wg.fillStyle = '#dc2626'; wg.fillRect(0, 0, 512, 110);
    wg.fillStyle = '#fff'; wg.font = `900 58px ${FONT}`; wg.textAlign = 'center'; wg.textBaseline = 'middle'; wg.fillText('ROBOTERFELD', 256, 58);
    wg.fillStyle = '#111'; wg.font = `700 40px ${FONT}`; wg.fillText('Zutritt verboten', 256, 170);
    wg.font = `500 30px ${FONT}`; wg.fillText('Automatischer Betrieb –', 256, 240); wg.fillText('Betreten löst Not-Halt aus', 256, 285);
    wg.strokeStyle = '#dc2626'; wg.lineWidth = 14; wg.strokeRect(7, 7, 498, 370);
    for (const [x, z, ry] of [[OX + 0.04, -3.6, Math.PI / 2], [OX + 0.04, 3.4, Math.PI / 2], [OX + 0.04, 7.0, Math.PI / 2], [2, FENCE.maxZ + 0.04, 0], [-8, FENCE.maxZ + 0.04, 0], [0, FENCE.minZ - 0.04, Math.PI]]) {
      const s = signMesh(ctx, warn, 0.6, 0.45); s.position.set(x, 1.45, z); s.rotation.y = ry; root.add(s);
    }

    // Gehweg (grün) vom Eingang zur Station
    floorLines(ctx, [
      { x1: 12.3, z1: 11.6, x2: 12.3, z2: 1.6, w: 0.08 }, { x1: 13.7, z1: 11.6, x2: 13.7, z2: 3.2, w: 0.08 },
      { x1: 12.3, z1: 1.6, x2: 11.1, z2: 1.6, w: 0.08 }, { x1: 13.7, z1: 3.2, x2: 16.5, z2: 3.2, w: 0.08 },
    ], { color: 0x16a34a, roughness: 0.6 });
    floorLines(ctx, [{ x1: OX + 0.25, z1: -0.9, x2: OX + 0.25, z2: 0.9, w: 0.05 }], { color: 0xf2c21b });

    // ---------- Interaktion: Fächer des präsentierten Pods
    const S = {
      phase: 'login', current: null, pickIdx: 0, holding: null, estop: false, estopClear: false, done: false,
      units: 0, lines: 0, waitT: 0, waitSince: null, lastPresentT: null, screenT: 0, wallT: 0, errorsShown: 0,
      fehlReported: false, flashBin: null, flashT: 0, podCollider: null, msg: null, msgT: 0,
    };
    const binTargets = [];
    for (let r = 0; r < POD.ROWS; r++) for (let c = 0; c < POD.COLS; c++) {
      const hb = Interaction.hitBox(POD.DEPTH, POD.ROWH - 0.05, POD.COLW - 0.02);
      hb.position.set(PX + POD.DEPTH / 2 + 0.01, rowY(r) + POD.LIFT + (POD.ROWH - 0.05) / 2, PZ + POD.COLW * (1 - c));
      root.add(hb);
      binTargets.push(interaction.add({
        object: hb, kind: 'bin', maxDist: 2.6, maxDistXR: 2.2,
        label: () => `Fach ${binLabel(r, c)}`,
        sub: () => { const b = curBin(r, c); return b ? `${b.sku.name} · ${b.stock} Stück` : ''; },
        color: 0x5eead4,
        visibleCheck: () => !!S.current && !S.estop,
        onPrimary: () => onBinClick(r, c),
        onSecondary: () => onBinBack(r, c),
      }));
    }
    function curBin(r, c) { const v = S.current; return v ? v.pod.bins[v.face][r][c] : null; }
    function curPick() { const v = S.current; return v ? v.picks[S.pickIdx] : null; }

    // Putwall-Fächer
    pw.slots.forEach((s, k) => {
      interaction.add({
        object: s.hit, kind: 'container', color: 0x34d399, maxDist: 2.8, maxDistXR: 2.2,
        label: () => `Putwall-Fach ${k + 1} · ${orders[k].no}`,
        sub: () => orders[k].done ? 'Auftrag fertig ✓' : `${orders[k].lines.reduce((a, l) => a + l.put, 0)} / ${orders[k].lines.reduce((a, l) => a + l.qty, 0)} Artikel`,
        onPrimary: () => onSlotClick(k),
      });
    });

    // Bildschirm (Touch)
    const BTN = { login: [262, 400, 500, 120], fehl: [688, 566, 316, 58], ack: [262, 430, 500, 110] };
    interaction.add({
      object: screen, kind: 'button', color: 0x2dd4bf, highlight: false, maxDist: 2.6, maxDistXR: 2.4,
      label: 'Stationsbildschirm',
      sub: () => S.phase === 'login' ? 'Antippen: Anmelden' : S.estop ? (S.estopClear ? 'Antippen: Quittieren' : 'Erst das Roboterfeld verlassen!') : 'Touchscreen',
      onPrimary: (e, hit) => {
        if (!hit || !hit.uv) return;
        const x = hit.uv.x * 1024, y = (1 - hit.uv.y) * 640;
        const inB = b => x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3];
        if (S.phase === 'login') { login(); return; }
        if (S.estop) { acknowledge(); return; }    // ganzer Bildschirm = Quittier-Taste
        if (inB(BTN.fehl)) reportFehlteil();
        else audio.play('button');
      },
    });

    // ---------- Prozess
    const mission = ctx.mission({ targetTime: 300, expectedLines: TOTAL_LINES });
    fleet.onPresent = v => { S.ready = v; tryStart(); };

    // Das WMS ruft die ersten zwei Pods schon zu Schichtbeginn vor (Vorsteuerung), den Rest nach der Anmeldung
    let preDispatched = 0;
    function preDispatch() {
      for (; preDispatched < Math.min(2, visits.length); preDispatched++) fleet.enqueue(visits[preDispatched]);
    }

    function login() {
      if (S.phase !== 'login') return;
      S.phase = 'run';
      audio.play('ok');
      st.setLight('wait');
      preDispatch();
      for (let i = preDispatched; i < visits.length; i++) fleet.enqueue(visits[i]);
      preDispatched = visits.length;
      S.waitSince = mission.elapsed;
      ui.toast('Angemeldet! Das System ruft die **Pods** mit deinen Artikeln zur Station.', 'ok', 3500);
      setObjective();
      drawScreen();
      tryStart();
    }

    function tryStart() {
      if (S.phase !== 'run' || S.current || !S.ready) return;
      const v = S.ready; S.ready = null;
      S.current = v;
      S.pickIdx = v.picks.findIndex(p => !p.done && !p.rerouted);
      if (S.waitSince != null) { S.waitT += mission.elapsed - S.waitSince; S.waitSince = null; }
      S.podCollider = player.addBox(PX - 0.5, PZ - 0.5, PX + 0.55, PZ + 0.5, 'pod');
      if (S.pickIdx < 0) { releaseCurrent(); return; }
      audio.play('light');
      st.setLight('run');
      showPick();
    }

    function showPick() {
      const p = curPick();
      if (!p) return;
      const pos = new THREE.Vector3(PX + POD.DEPTH + 0.004, rowY(p.r) + POD.LIFT + (POD.ROWH - 0.05) / 2, PZ + POD.COLW * (1 - p.c));
      pointer.pointAt(pos);
      drawScreen();
      setObjective();
    }

    function onBinClick(r, c) {
      if (S.estop) return;
      const v = S.current, p = curPick();
      if (!v || !p) return;
      if (S.holding && S.holding.pick !== p) { ui.toast('Leg zuerst den Artikel in der Hand in die **Putwall**.', 'warn'); return; }
      if (r !== p.r || c !== p.c) {
        mission.error('wrong_bin', `Pod ${v.pod.no}: Fach ${binLabel(r, c)} statt ${binLabel(p.r, p.c)}`);
        ui.toast(`Falsches Fach! Die Kamera erkennt **${curBin(r, c).sku.name}**. Gesucht: Fach **${binLabel(p.r, p.c)}**.`, 'error', 4200);
        flashBin(r, c);
        return;
      }
      const bin = curBin(r, c);
      if (bin.stock <= 0) {
        audio.play('warn');
        ui.toast('Das Fach ist **leer**! Melde am Bildschirm ein **Fehlteil**.', 'warn', 4500);
        S.emptySeen = true;
        drawScreen();
        return;
      }
      if (S.holding && S.holding.taken >= p.qty) { ui.toast(`Du hast schon ${p.qty} Stück. Jetzt ab in die Putwall!`, 'info'); return; }
      fleet.takeUnit(v.pod, v.face, r, c);
      if (!S.holding) S.holding = { pick: p, taken: 0 };
      S.holding.taken++;
      hand.take(p.p.id, p.p.name, 1, () => itemMesh(p.p), { skuObj: p.p, handSize: 0.17 });
      mission.pick(1);
      audio.play('scan');
      if (S.holding.taken >= p.qty) {
        pointer.hide();
        pw.setState(p.order, 'target');
        audio.play('light');
      }
      drawScreen(); setObjective();
    }

    function onBinBack(r, c) {
      const v = S.current, p = curPick();
      if (!v || !p || !S.holding || r !== p.r || c !== p.c) { ui.toast('Rechtsklick legt einen gerade entnommenen Artikel zurück ins Fach.', 'info', 2500); return; }
      hand.give(1);
      const bin = curBin(r, c);
      bin.stock++;
      const hidden = bin.units.filter(i => fleet.items.hidden[i]);
      if (hidden.length) fleet.items.setHidden(hidden[0], false);
      S.holding.taken--;
      mission.units = Math.max(0, mission.units - 1);
      if (S.holding.taken <= 0) S.holding = null;
      pw.setState(p.order, orders[p.order].done ? 'done' : 'idle');
      showPick();
      audio.play('put');
    }

    function onSlotClick(k) {
      if (S.estop) return;
      const p = curPick();
      if (!S.holding || !p) { ui.toast(hand.empty ? 'Nimm zuerst den Artikel aus dem angezeigten **Fach** des Pods.' : 'Erst die volle Menge entnehmen.', 'info', 2600); return; }
      if (S.holding.taken < p.qty) { ui.toast(`Es fehlen noch ${p.qty - S.holding.taken} Stück aus Fach ${binLabel(p.r, p.c)}.`, 'warn'); return; }
      if (k !== p.order) {
        mission.error('wrong_tote', `Putwall-Fach ${k + 1} statt ${p.order + 1}`);
        ui.toast(`Falsches Putwall-Fach! Der Artikel gehört in **Fach ${p.order + 1}** (blinkt grün).`, 'error', 3800);
        pw.flashError(k);
        return;
      }
      // ablegen
      const n = hand.count;
      hand.give(n);
      const slot = pw.slots[k];
      for (let i = 0; i < n; i++) {
        const m = itemMesh(p.p); fitObject(m, 0.13);
        const holder = new THREE.Group(); holder.add(m);
        const idx = slot.contents.length;
        holder.position.set(-0.1 + (idx % 3) * 0.1, 0.06 + Math.floor(idx / 3) * 0.06, -0.08 + (idx % 2) * 0.12);
        holder.rotation.y = (idx * 1.3) % 1 - 0.5;
        slot.tote.add(holder);
        slot.contents.push(holder);
      }
      audio.play('put');
      slot.confirmT = 0.5;
      audio.play('ok');
      p.line.put += p.qty;
      p.done = true;
      S.holding = null;
      S.units += p.qty; S.lines++;
      mission.line(1);
      const o = orders[k];
      if (o.lines.every(l => l.put >= l.qty)) {
        o.done = true;
        pw.setState(k, 'done');
        sendTote(k);
        ui.toast(`Auftrag **${o.no}** komplett – Behälter fährt zur Packerei.`, 'ok', 3000);
      } else pw.setState(k, 'idle');
      nextPick();
    }

    function nextPick() {
      const v = S.current;
      const idx = v ? v.picks.findIndex(p => !p.done && !p.rerouted) : -1;
      if (v && idx >= 0) { S.pickIdx = idx; showPick(); return; }
      releaseCurrent();
    }

    function releaseCurrent() {
      const v = S.current;
      pointer.hide();
      if (v) fleet.release(v);
      S.current = null;
      if (S.podCollider) { player.removeCollider(S.podCollider); S.podCollider = null; }
      if (orders.every(o => o.done)) { finish(); return; }
      S.waitSince = mission.elapsed;
      st.setLight('wait');
      drawScreen(); setObjective();
      if (S.ready) setTimeout(tryStart, 50);
    }

    function reportFehlteil() {
      const p = curPick();
      if (!p) { audio.play('button'); return; }
      const bin = curBin(p.r, p.c);
      if (bin.stock > 0) { audio.play('warn'); ui.toast('Das Fach ist nicht leer – schau genau hin. Fehlteile nur melden, wenn wirklich nichts da ist.', 'warn', 4200); return; }
      audio.play('ok');
      p.rerouted = true;
      S.fehlReported = true;
      if (fehl && fehl.pick === p) {
        const b = fehl.backup;
        const nv = { id: 99, pod: b.pod, face: b.f, picks: [{ ...p, rerouted: false, fehlteil: false, done: false, r: b.r, c: b.c, k: b.k, backup: true }] };
        nv.picks[0].visit = nv;
        fleet.enqueue(nv, true);
      }
      ui.toast('Fehlteil gemeldet. Das System bucht den Bestand aus und schickt einen **anderen Pod** mit dem Artikel.', 'ok', 4800);
      nextPick();
    }

    function finish() {
      if (S.done) return;
      S.done = true; S.phase = 'done';
      st.setLight('off');
      pointer.hide();
      drawScreen(); setObjective();
      const r = mission.finish({ extraWait: S.waitT });
      const all = loadResults();
      const rows = LEVELS.map(l => {
        const x = l.id === 'lager4' ? r : (all[l.id] && all[l.id].last);
        return [`Lager ${l.num}`, l.kind, x ? fmtNum(x.linesPerHour) : '–', x ? fmtNum(x.distance) + ' m' : '–', x ? { t: String(x.errorCount), cls: x.errorCount ? 'st-err' : 'st-ok' } : '–'];
      });
      const l1 = all.lager1 && all.lager1.last;
      const factor = l1 && l1.linesPerHour > 0 ? r.linesPerHour / l1.linesPerHour : null;
      ctx.complete(r, {
        title: 'Schicht beendet – alle Aufträge erledigt',
        blocks: [
          { h: 'Mann-zur-Ware vs. Ware-zur-Person' },
          { table: { head: ['Lager', 'Prinzip', 'Pos./h', 'Laufweg', 'Fehler'], rows } },
          { p: `Du bist hier nur **${fmtNum(r.distance)} m** gelaufen – die Roboter sind zusammen **${fmtNum(fleet.stats.distance)} m** gefahren. Wartezeit auf Pods: **${fmtTime(S.waitT)}**.` + (factor && factor >= 1.2 ? ` Deine Pickleistung war etwa **${fmtNum(factor, 1)}-mal so hoch** wie in Lager 1.` : '') + (l1 ? '' : ' Spiel auch Lager 1, um Mann-zur-Ware und Ware-zur-Person direkt zu vergleichen.') },
          { h: 'Was macht der Mensch hier noch?' },
          { list: ['**Greifen & Prüfen:** Tausende verschiedene Artikel sicher zu greifen, ist für Roboter (noch) schwierig – für Menschen leicht.', '**Ausnahmen lösen:** Fehlteile, beschädigte Ware, falsch eingelagerte Artikel – hier ist Urteilsvermögen gefragt.', '**Neue Aufgaben:** Anlagen überwachen, Roboter warten, Prozesse verbessern, Daten auswerten.'] },
        ],
        lesson: 'Bei **Ware-zur-Person** entfällt die Wegzeit fast vollständig – deshalb steigt die Pickleistung enorm. Dafür braucht es hohe **Investitionen**, eine zuverlässige **IT (WMS/WCS)** und gute **Arbeitsorganisation** gegen Monotonie. Der Mensch bleibt wichtig – aber seine Rolle verändert sich.',
      });
    }

    // Behälter zur Packerei schicken
    const totesMoving = [];
    function sendTote(k) {
      const s = pw.slots[k];
      const t = s.tote;
      const start = t.position.clone();
      totesMoving.push({ t, start, phase: 0, time: 0, k });
    }
    function tickTotes(dt) {
      for (let i = totesMoving.length - 1; i >= 0; i--) {
        const m = totesMoving[i];
        m.time += dt;
        const local = m.t.position;
        const convLocalZ = conveyorZ - pw.group.position.z;     // in Putwall-Koordinaten
        const convLocalY = 0.76 - 0.005;
        if (m.phase === 0) {
          const k = Math.min(1, m.time / 0.9);
          local.z = THREE.MathUtils.lerp(m.start.z, convLocalZ, k);
          local.y = THREE.MathUtils.lerp(m.start.y, convLocalY, Math.min(1, k * 1.4));
          if (k >= 1) { m.phase = 1; m.time = 0; }
        } else {
          local.x += dt * 0.9;
          if (local.x + pw.group.position.x > 15.45) { m.t.visible = false; totesMoving.splice(i, 1); }
        }
      }
    }

    function flashBin(r, c) {
      const pos = new THREE.Vector3(PX + POD.DEPTH + 0.004, rowY(r) + POD.LIFT + (POD.ROWH - 0.05) / 2, PZ + POD.COLW * (1 - c));
      const p = curPick();
      pointer.pointAt(pos, 0xff3b30);
      S.flashT = 0.7;
      S.flashBack = p;
    }

    // ---------- Not-Halt
    let alarmT = 0;
    function triggerEStop() {
      S.estop = true; S.estopClear = false;
      fleet.setEStop(true);
      st.setLight('stop');
      st.beamMat.opacity = 0.6;
      mission.error('safety', 'Roboterfeld betreten – Not-Halt ausgelöst');
      ui.toast('**NOT-HALT!** Du hast den Lichtvorhang durchquert. Alle Roboter stoppen. Verlasse sofort das Feld!', 'error', 6000);
      audio.play('alarm');
      alarmT = 1.4;
      drawScreen(); setObjective();
    }
    function acknowledge() {
      if (!S.estop) return;
      if (!S.estopClear) { audio.play('warn'); ui.toast('Erst das Roboterfeld verlassen, dann quittieren.', 'warn'); return; }
      S.estop = false;
      fleet.setEStop(false);
      st.setLight(S.current ? 'run' : 'wait');
      st.beamMat.opacity = 0.03;
      audio.play('ok');
      ui.toast('Not-Halt quittiert – die Anlage läuft wieder.', 'ok');
      drawScreen(); setObjective();
    }

    // ---------- Artikel-Darstellung (Hand / Putwall)
    const itemMats = new Map();
    function itemMesh(p) {
      if (p.model && assets.templates.get(p.model)) return assets.get(p.model);
      if (!itemMats.has(p.id)) {
        const tex = ctx.track(new THREE.CanvasTexture(prodCanvas.get(p.id))); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
        const side = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55 });
        ctx.track(front); ctx.track(side);
        itemMats.set(p.id, [side, side, side, side, front, side]);
      }
      const g = new THREE.Group();
      const geo = new THREE.BoxGeometry(...p.size); ctx.track(geo);
      g.add(new THREE.Mesh(geo, itemMats.get(p.id)));
      return g;
    }

    // ---------- Bildschirm zeichnen
    const SC = { W: 1024, H: 640 };
    function drawScreen() {
      const g = ui.device.ctx, W = SC.W, Hh = SC.H;
      g.save();
      g.fillStyle = '#070b12'; g.fillRect(0, 0, W, Hh);
      // Kopfzeile
      const hdr = g.createLinearGradient(0, 0, W, 0); hdr.addColorStop(0, '#0f172a'); hdr.addColorStop(1, '#111c33');
      g.fillStyle = hdr; g.fillRect(0, 0, W, 64);
      g.fillStyle = '#22d3ee'; g.fillRect(0, 62, W, 2);
      g.fillStyle = '#e2e8f0'; g.font = `800 28px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText('ORBIT  ·  STATION 3', 24, 33);
      g.font = `500 22px ${MONO}`; g.textAlign = 'right'; g.fillStyle = '#94a3b8';
      g.fillText(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + '   Picker: du', W - 24, 33);
      g.textAlign = 'left';
      const p = curPick();
      if (S.estop) {
        g.fillStyle = '#450a0a'; g.fillRect(0, 64, W, Hh - 64);
        g.fillStyle = '#ef4444'; g.font = `900 78px ${FONT}`; g.textAlign = 'center'; g.fillText('NOT-HALT', W / 2, 190);
        g.fillStyle = '#fecaca'; g.font = `600 32px ${FONT}`;
        g.fillText('Person im Roboterfeld erkannt – alle Roboter gestoppt.', W / 2, 270);
        g.fillText(S.estopClear ? 'Feld ist frei. Tippe auf QUITTIEREN.' : 'Verlasse das Feld hinter dem Lichtvorhang!', W / 2, 320);
        button(g, BTN.ack, 'QUITTIEREN', S.estopClear ? '#f59e0b' : '#3f3f46', S.estopClear ? '#111' : '#a1a1aa');
      } else if (S.phase === 'login') {
        g.fillStyle = '#e2e8f0'; g.font = `800 46px ${FONT}`; g.textAlign = 'center';
        g.fillText('Willkommen an Station 3', W / 2, 170);
        g.fillStyle = '#94a3b8'; g.font = `500 28px ${FONT}`;
        g.fillText('Melde dich an – dann ruft das System die Pods mit deinen Artikeln.', W / 2, 228);
        g.fillText(`Heute: ${orders.length} Kundenaufträge · ${TOTAL_UNITS} Artikel`, W / 2, 272);
        button(g, BTN.login, 'ANMELDEN', '#22c55e', '#052e16');
      } else if (S.phase === 'done') {
        g.fillStyle = '#22c55e'; g.font = `900 60px ${FONT}`; g.textAlign = 'center'; g.fillText('Alle Aufträge erledigt!', W / 2, 250);
        g.fillStyle = '#cbd5e1'; g.font = `500 30px ${FONT}`; g.fillText(`${S.units} Artikel in ${fmtTime(mission.elapsed)} – danke!`, W / 2, 310);
      } else if (!S.current || !p) {
        // Warten auf Pod
        g.fillStyle = '#e2e8f0'; g.font = `800 40px ${FONT}`; g.textAlign = 'center';
        g.fillText('Nächster Pod ist unterwegs …', W / 2, 200);
        const t = engine.time;
        g.strokeStyle = '#22d3ee'; g.lineWidth = 10; g.lineCap = 'round';
        g.beginPath(); g.arc(W / 2, 320, 56, t * 4, t * 4 + 4.2); g.stroke();
        const lane = fleet.robots.filter(r => r.stationBound);
        g.fillStyle = '#94a3b8'; g.font = `500 26px ${FONT}`;
        g.fillText(lane.length ? `${lane.length} Roboter auf dem Weg zur Station · nächster: ${lane[0].name}` : 'Roboter werden disponiert …', W / 2, 430);
      } else {
        const v = S.current;
        // links: Produkt
        g.fillStyle = '#0f172a'; roundRect(g, 20, 84, 420, 460, 18); g.fill();
        g.drawImage(prodCanvas.get(p.p.id), 70, 104, 320, 320);
        g.fillStyle = '#f8fafc'; g.font = `800 28px ${FONT}`; g.textAlign = 'left';
        g.fillText(p.p.name, 40, 458, 380);
        g.fillStyle = '#94a3b8'; g.font = `500 22px ${FONT}`; g.fillText(`${p.p.brand} · ${p.p.variant}`, 40, 492, 380);
        g.font = `500 20px ${MONO}`; g.fillText('EAN ' + p.p.ean, 40, 524);
        // rechts: Fach + Menge
        const holdingDone = S.holding && S.holding.taken >= p.qty;
        if (!holdingDone) {
          g.fillStyle = '#94a3b8'; g.font = `600 24px ${FONT}`; g.fillText(`POD ${v.pod.no} · SEITE ${v.face === 0 ? 'A' : 'B'}`, 470, 110);
          g.fillStyle = '#5eead4'; g.font = `900 150px ${FONT}`; g.fillText(binLabel(p.r, p.c), 462, 230);
          // Pod-Schema
          const gx = 770, gy = 92, cw = 70, chh = 52;
          for (let r = POD.ROWS - 1; r >= 0; r--) for (let c = 0; c < POD.COLS; c++) {
            const yy = gy + (POD.ROWS - 1 - r) * (chh + 6), xx = gx + c * (cw + 6);
            const isT = r === p.r && c === p.c;
            g.fillStyle = isT ? '#14b8a6' : '#1e293b'; roundRect(g, xx, yy, cw, chh, 8); g.fill();
            g.fillStyle = isT ? '#042f2e' : '#64748b'; g.font = `700 20px ${FONT}`; g.textAlign = 'center'; g.fillText(binLabel(r, c), xx + cw / 2, yy + chh / 2 + 1); g.textAlign = 'left';
          }
          g.fillStyle = '#e2e8f0'; g.font = `800 56px ${FONT}`;
          g.fillText(`${p.qty} ×`, 470, 330);
          g.fillStyle = '#94a3b8'; g.font = `500 24px ${FONT}`;
          g.fillText(S.holding ? `entnommen: ${S.holding.taken} / ${p.qty}` : 'entnehmen', 470, 372);
          if (S.emptySeen && p.fehlteil && !p.rerouted) { g.fillStyle = '#fbbf24'; g.font = `700 26px ${FONT}`; g.fillText('Fach leer? → Fehlteil melden', 470, 430); }
        } else {
          g.fillStyle = '#94a3b8'; g.font = `600 26px ${FONT}`; g.fillText('ABLEGEN IN PUTWALL-FACH', 470, 112);
          g.fillStyle = '#4ade80'; g.font = `900 150px ${FONT}`; g.fillText(String(p.order + 1), 470, 236);
          g.fillStyle = '#e2e8f0'; g.font = `600 26px ${FONT}`; g.fillText(orders[p.order].no + ' · ' + orders[p.order].customer, 470, 330, 520);
          // Putwall-Schema
          for (let k = 0; k < 8; k++) {
            const c = k % 4, rr = Math.floor(k / 4);
            const xx = 470 + c * 96, yy = 370 + rr * 70;
            const isT = k === p.order;
            g.fillStyle = orders[k].done ? '#1d4ed8' : isT ? '#22c55e' : '#1e293b'; roundRect(g, xx, yy, 86, 60, 8); g.fill();
            g.fillStyle = isT ? '#052e16' : '#cbd5e1'; g.font = `800 28px ${FONT}`; g.textAlign = 'center'; g.fillText(String(k + 1), xx + 43, yy + 31); g.textAlign = 'left';
          }
        }
        // Fußzeile
        button(g, BTN.fehl, 'Fehlteil melden', '#1f2937', '#fbbf24', '#fbbf24');
      }
      // Fortschritt
      if (S.phase !== 'login') {
        g.fillStyle = '#1e293b'; roundRect(g, 24, 584, 620, 16, 8); g.fill();
        g.fillStyle = '#22d3ee'; roundRect(g, 24, 584, Math.max(16, 620 * S.units / TOTAL_UNITS), 16, 8); g.fill();
        g.fillStyle = '#94a3b8'; g.font = `500 20px ${FONT}`; g.textAlign = 'left';
        g.fillText(`${S.units} / ${TOTAL_UNITS} Artikel · ${orders.filter(o => o.done).length} / ${orders.length} Aufträge`, 24, 568);
      }
      g.restore();
      ui.device.update();
    }
    function button(g, b, text, bg, fg, stroke) {
      g.fillStyle = bg; roundRect(g, b[0], b[1], b[2], b[3], 18); g.fill();
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 3; g.stroke(); }
      g.fillStyle = fg; g.font = `800 ${Math.round(b[3] * 0.42)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, b[0] + b[2] / 2, b[1] + b[3] / 2 + 2);
      g.textAlign = 'left';
    }

    // ---------- Leitstand-Anzeige zeichnen
    function drawWall() {
      const g = wallC.getContext('2d'), W = 1280, Hh = 400;
      g.fillStyle = '#05080d'; g.fillRect(0, 0, W, Hh);
      g.fillStyle = '#e2e8f0'; g.font = `800 30px ${FONT}`; g.textBaseline = 'top'; g.textAlign = 'left';
      g.fillText('STATION 3 · LIVE', 28, 22);
      const el = Math.max(1, mission.running || S.done ? mission.elapsed : 1);
      const pph = S.units / (el / 3600);
      g.fillStyle = '#22d3ee'; g.font = `900 120px ${FONT}`; g.fillText(S.units ? fmtNum(pph) : '—', 26, 66);
      g.fillStyle = '#94a3b8'; g.font = `600 26px ${FONT}`; g.fillText('Picks pro Stunde', 30, 196);
      const c = fleet.counts();
      const kp = [['Picks', `${S.units}/${TOTAL_UNITS}`], ['Fehler', String(mission.errors.length)], ['Zeit', fmtTime(mission.running || S.done ? mission.elapsed : 0)], ['Roboter', `${c.active} aktiv · ${c.charging} laden`]];
      kp.forEach(([l, v], i) => {
        const x = 28 + (i % 2) * 260, y = 250 + Math.floor(i / 2) * 72;
        g.fillStyle = '#e2e8f0'; g.font = `800 34px ${FONT}`; g.fillText(v, x, y);
        g.fillStyle = '#64748b'; g.font = `500 20px ${FONT}`; g.fillText(l, x, y + 40);
      });
      fleet.drawMap(g, 560, 20, 700, 360);
      g.fillStyle = 'rgba(148,163,184,0.9)'; g.font = `500 18px ${FONT}`; g.fillText('Flottenkarte (WCS) · gelb = Pod · Punkt = Roboter', 572, 26);
      wallTex.needsUpdate = true;
    }

    // ---------- Ziele / HUD
    function setObjective() {
      let t;
      if (S.estop) t = '**Not-Halt!** Verlasse das Roboterfeld und **quittiere** am Bildschirm.';
      else if (S.phase === 'login') t = 'Geh zur **Station 3** (grüner Gehweg) und tippe auf dem **Bildschirm** auf **Anmelden**.';
      else if (S.phase === 'done') t = 'Alle Aufträge erledigt!';
      else if (!S.current) t = 'Warte kurz – ein Roboter bringt den nächsten **Pod**.';
      else {
        const p = curPick();
        if (S.holding && S.holding.taken >= p.qty) t = `Lege den Artikel in **Putwall-Fach ${p.order + 1}** (blinkt grün, rechts von dir).`;
        else t = `Nimm **${p.qty} × ${p.p.name}** aus **Fach ${binLabel(p.r, p.c)}** (Lichtzeiger).` + (p.fehlteil && S.emptySeen ? ' Fach leer → **Fehlteil melden**!' : '');
      }
      ui.setObjective(t);
    }

    // ---------- Laufende Aktualisierung
    const motors = fleet.robots.map(r => audio.loop('motor', r.audioObj, { freq: 62, cutoff: 420, gain: 0, ref: 2.5 }));
    ctx.onUpdate((dt, time) => {
      fleet.update(dt);
      fleet.robots.forEach((r, i) => {
        const g = Math.round(Math.min(0.08, r.v * 0.05) * 200) / 200;
        if (g !== motors[i]._g) { motors[i]._g = g; motors[i].setGain(g); }
      });
      pointer.pulse(time);
      pw.tick(time, dt);
      tickTotes(dt);
      if (S.flashT > 0) { S.flashT -= dt; if (S.flashT <= 0 && S.current && !(S.holding && S.holding.taken >= curPick().qty)) showPick(); else if (S.flashT <= 0) pointer.hide(); }
      chargerLeds.forEach((led, i) => {
        if (!led) return;
        const busy = fleet.robots.some(r => r.cell.i === 0 && r.cell.j === CHARGER_ROWS[i] && r.jobs.length && r.jobs[0].t === 'charge');
        led.material.emissiveIntensity = busy ? 1.5 + Math.sin(time * 4) * 1.2 : 0.4;
      });
      // Sicherheit: Person im Feld?
      const hp = engine.headPosition(tmpV);
      const inField = hp.x < OX - 0.03 && hp.x > FENCE.minX - 0.3 && hp.z > FENCE.minZ - 0.3 && hp.z < FENCE.maxZ + 0.3;
      if (mission.running && inField && !S.estop) triggerEStop();
      if (S.estop) {
        const clear = !inField;
        if (clear !== S.estopClear) { S.estopClear = clear; drawScreen(); }
        alarmT -= dt;
        if (alarmT <= 0) { audio.play('alarm'); alarmT = 1.6; }
        st.beamMat.opacity = 0.3 + 0.3 * Math.abs(Math.sin(time * 10));
      }
      // Bildschirm-Animation (Warten) & Anzeigetafel
      S.screenT -= dt;
      if (S.screenT <= 0) { S.screenT = (!S.current && S.phase === 'run') ? 0.3 : 1.0; drawScreen(); }
      S.wallT -= dt;
      if (S.wallT <= 0) { S.wallT = 0.5; drawWall(); }
      if (mission.running) {
        const el = Math.max(1, mission.elapsed);
        ui.setStats([
          { label: 'Zeit', value: fmtTime(el) },
          { label: 'Artikel', value: `${S.units}/${TOTAL_UNITS}` },
          { label: 'Picks/h', value: S.units ? fmtNum(S.units / (el / 3600)) : '–' },
          { label: 'Fehler', value: String(mission.errors.length), cls: mission.errors.length ? 'err' : '' },
        ]);
      }
    });

    // ---------- Licht
    const fixtures = [];
    for (let x = -15; x <= 16; x += 4.4) for (let z = -9.5; z <= 9.5; z += 4.75) fixtures.push({ x, z, ry: 0 });
    setupLighting(ctx, {
      sky: 0xc4d3ee, ground: 0x56606c, hemi: 0.6, key: 1.9, keyColor: 0xe6efff, keyDir: [0.25, 1, 0.3], exposure: 1.6,
      fixtures, fixtureKind: 'panel', fixtureHeight: 7.25, ceilingY: HALL.h, lampColor: 0xeef4ff, lampIntensity: 2.4, cables: true,
      points: [{ x: 10.2, y: 3.0, z: 0.0, intensity: 9, distance: 7, color: 0xdbe8ff }, { x: 14.6, y: 2.6, z: 4.6, intensity: 5, distance: 6, color: 0xbfe3ff }],
      background: 0x0a0e14, shadowExtent: 12,
    });
    bakeFloorAO(ctx, hall.floor, HALL.w, HALL.d, footprints, { edge: 0.7, edgeStrength: 0.5 });

    // ---------- Infopunkte
    const info = (x, y, z, card) => ctx.addInfoPoint(new THREE.Vector3(x, y, z), card);
    info(9.55, 2.25, -0.95, {
      title: 'Ware-zur-Person', subtitle: 'Die Regale kommen zu dir',
      blocks: [
        { p: 'In Lager 1 bist du zur Ware gelaufen (**Mann-zur-Ware**). Hier ist es umgekehrt: **Roboter bringen die Ware zum Menschen** – das nennt man **Ware-zur-Person** (Goods-to-Person).' },
        { list: ['Die **Wegzeit** des Pickers fällt fast komplett weg.', 'Der Picker steht an einer **ergonomischen Station** – Greifhöhe, Licht und Bildschirm sind optimiert.', 'Dadurch sind **mehrere hundert Picks pro Stunde** möglich – ein Vielfaches von Mann-zur-Ware.'] },
        { callout: 'Ware-zur-Person-Systeme gibt es in vielen Varianten: mobile Roboter mit Regalen (wie hier), automatische Kleinteilelager mit Shuttles oder Würfelspeicher, in denen Roboter Behälter von oben holen.', tone: 'teal' },
      ],
    });
    info(OX + 0.3, 1.7, -4.6, {
      title: 'Mobile Roboter (AMR)', subtitle: 'Wie finden die Roboter ihren Weg?',
      blocks: [
        { p: 'Die flachen Roboter fahren **unter die Regale (Pods)**, heben sie ein paar Zentimeter an und tragen sie zur Station.' },
        { list: ['**Navigation:** Auf dem Boden kleben **Codes (Fiducials)** im festen Raster. Eine Kamera unter dem Roboter liest sie – so weiß er auf den Millimeter, wo er ist.', '**Kollisionsvermeidung:** Der Leitrechner reserviert für jeden Roboter die nächsten Felder. Ist ein Feld belegt, wartet der Roboter oder plant einen neuen Weg.', '**Sensoren** an Bord stoppen den Roboter zusätzlich bei Hindernissen.'] },
        { callout: 'Schau auf die **Flottenkarte** über der Station: Dort siehst du live, wohin die Roboter fahren.' },
      ],
    });
    info(OX + 0.3, 1.7, 3.0, {
      title: 'Akkus laden', subtitle: 'Opportunity Charging',
      blocks: [
        { p: 'Die Roboter fahren elektrisch. Hinten an der Wand (links im Feld) stehen die **Ladestationen**.' },
        { list: ['Statt lange Pausen zu machen, laden die Roboter **zwischendurch kurz** – immer dann, wenn gerade wenig zu tun ist (**Opportunity Charging**).', 'Das System plant das Laden so, dass immer genug Roboter einsatzbereit sind.', 'Ein Roboter mit schwachem Akku bekommt keine neuen Aufträge, sondern fährt zur Ladestation.'] },
      ],
    });
    info(OX + 0.35, 3.0, 2.95, {
      title: 'WMS & WCS', subtitle: 'Das System steuert alles',
      blocks: [
        { p: 'Ohne IT läuft hier nichts. Zwei Systeme arbeiten zusammen:' },
        { list: ['**WMS (Lagerverwaltungssystem):** kennt alle Artikel, Bestände und Lagerplätze – auch die **chaotische Lagerung** in den Pods. Es entscheidet, welche Aufträge wann bearbeitet werden.', '**WCS (Steuerung der Fördertechnik/Roboter):** verteilt die Fahraufträge, plant Wege, verhindert Zusammenstöße, schickt Roboter zum Laden.', 'Oft gibt das System **Schnelldreher-Pods** nach vorne in Stationsnähe (**dynamische Lagerplatzvergabe**).'] },
        { callout: 'Fällt die IT aus, steht das Lager. Deshalb gibt es Notfallpläne, Ersatzserver und Wartungsverträge.' },
      ],
    });
    info(STAND.x + 0.75, 1.45, 0.95, {
      title: 'Ergonomie & Arbeitsorganisation', subtitle: 'Gesund arbeiten an der Station',
      blocks: [
        { list: ['**Antiermüdungsmatte** und höhenoptimierte Fächer schonen Rücken und Gelenke.', 'Der Bildschirm zeigt nur das Nötigste – das senkt Fehler und Stress.', '**Monotonie** ist ein Risiko: Gegenmittel sind Pausen, Job-Rotation (Wechsel zwischen Picken, Einlagern, Problemlösung) und abwechslungsreiche Aufgaben.', 'Leistungskennzahlen (Picks/h) sollen **Prozesse** verbessern – nicht Menschen unter Druck setzen.'] },
      ],
    });
    info(13.0, 1.6, 5.2, {
      title: 'Vor- und Nachteile', subtitle: 'Lohnt sich ein Robotik-Lager?',
      blocks: [
        { table: { head: ['Vorteile', 'Nachteile'], rows: [['sehr hohe Pickleistung', 'hohe Investition (Millionen €)'], ['kaum Laufwege, ergonomisch', 'Abhängigkeit von IT & Technik'], ['flexibel erweiterbar (mehr Roboter)', 'Wartung & Fachpersonal nötig'], ['geringe Fehlerquote durch Systemführung', 'nicht jede Ware passt in Pods'], ['läuft rund um die Uhr', 'Ausfall trifft das ganze Lager']] } },
        { callout: 'Ob sich die Automatisierung lohnt, hängt vor allem vom **Auftragsvolumen** ab: Bei wenigen Bestellungen ist ein einfaches Fachbodenlager günstiger – bei sehr vielen Bestellungen rechnet sich die Technik.', tone: 'teal' },
      ],
    });

    S.screenT = 0;
    drawScreen(); drawWall(); setObjective();
    ui.device.show(true);
    ui.device.setCaption('Stationsbildschirm · <kbd>Tab</kbd> groß/klein');
    onProgress && onProgress(1, 'fertig');

    // Entwicklungs-/Testzugriff (z. B. für automatisierte Durchläufe)
    window.__picksimL4 = { S, fleet, orders, visits, pw, binTargets, fehl, mission, login, screen };
    const onDevice = () => { if (input.gameActive && !engine.isXR) ui.device.toggleBig(); };
    input.addEventListener('device', onDevice);
    const onConfirm = () => { if (!input.gameActive || ui.panelOpen) return; if (S.phase === 'login') login(); else if (S.estop) acknowledge(); };
    input.addEventListener('confirm', onConfirm);

    return {
      spawn: SPAWN,
      hints: [['WASD', 'gehen'], ['Klick', 'Fach / Putwall / Bildschirm'], ['Rechtsklick', 'zurücklegen'], ['Leertaste', 'anmelden / quittieren'], ['Tab', 'Bildschirm groß'], ['P', 'Pause']],
      briefing: {
        title: 'Lager 04 · Robotik-Center „Orbit“',
        subtitle: 'Ware-zur-Person · mobile Roboter (AMR) · Pick-Station',
        blocks: [
          { p: 'Willkommen im **Robotik-Center Orbit**. Hier läuft niemand mehr durch Regalgänge: **Mobile Roboter** fahren unter die Regale (**Pods**), heben sie an und bringen sie zu dir an die **Pick-Station**. Das Prinzip heißt **Ware-zur-Person**.' },
          { h: 'Dein Auftrag' },
          { list: [
            'Geh über den grünen Gehweg zur **Station 3** und tippe am **Bildschirm** auf **Anmelden**.',
            'Ein Roboter bringt einen Pod. **Bildschirm** und **Lichtzeiger** zeigen dir das richtige **Fach** – nimm die angezeigte **Menge**.',
            'Dreh dich nach rechts zur **Putwall**: Das grün blinkende Fach gehört zum Kundenauftrag – lege den Artikel dort ab.',
            'Ist ein Fach leer, melde am Bildschirm ein **Fehlteil** – das System schickt einen anderen Pod.',
            `Bearbeite so alle **${orders.length} Kundenaufträge** (${TOTAL_UNITS} Artikel).`,
          ] },
          { callout: '**Sicherheit:** Das Roboterfeld ist abgesperrt. Wer den **Lichtvorhang** an der Station durchquert, löst einen **Not-Halt** aus – alle Roboter stoppen sofort.' },
          { p: 'Achte auf die **Pickleistung** (Picks pro Stunde) auf der Anzeigetafel über der Station – und vergleiche sie am Ende mit Lager 1!' },
        ],
      },
      start() {
        mission.start();
        preDispatch();
        audio.ambient('robot');
        setObjective();
        ui.toast('Folge dem **grünen Gehweg** zur Station 3.', 'info', 4000);
      },
      async afterBuild() {
        captureEnvironment(ctx, new THREE.Vector3(-2, 1.8, 0), { intensity: 1.15 });
      },
      pauseBlocks: () => [{ p: `Erledigt: **${S.units} / ${TOTAL_UNITS} Artikel**, ${orders.filter(o => o.done).length} / ${orders.length} Aufträge. Fehler: ${mission.errors.length}.` }],
      quiz: QUIZ,
      dispose() {
        input.removeEventListener('device', onDevice);
        input.removeEventListener('confirm', onConfirm);
        fleet.onPresent = null;
        if (window.__picksimL4) delete window.__picksimL4;
      },
      _debug: { S, fleet, orders, visits, pw, binTargets, fehl },
    };
  },
};

const QUIZ = [
  { q: 'Welches Kommissionierprinzip wird im Robotik-Center „Orbit“ eingesetzt?', options: ['Mann-zur-Ware mit Papierliste', 'Ware-zur-Person – Roboter bringen die Regale zum Picker', 'Pick-by-Voice im Palettenregal', 'Cross-Docking ohne Lagerung'], correct: 1, explain: 'Die Pods kommen zur Station, der Picker bleibt stehen. Das ist Ware-zur-Person (Goods-to-Person).' },
  { q: 'Wie finden die mobilen Roboter (AMR) hier ihren Weg?', options: ['Per GPS-Satellit', 'Sie folgen dem Picker', 'Über Codes am Boden (Fiducials) und Sensoren – gesteuert vom Leitrechner', 'Über Schienen im Hallenboden'], correct: 2, explain: 'Die Roboter lesen Bodencodes im festen Raster, der Leitrechner (WCS) plant und reserviert die Wege.' },
  { q: 'Warum ist die Pickleistung hier so viel höher als in Lager 1?', options: ['Weil die Artikel kleiner sind', 'Weil die Wegzeit des Pickers fast vollständig entfällt', 'Weil es mehr Licht gibt', 'Weil keine Kontrolle stattfindet'], correct: 1, explain: 'In Mann-zur-Ware-Lagern macht das Gehen oft die Hälfte der Zeit aus. Bei Ware-zur-Person fällt sie weg – der Picker greift fast nur noch.' },
  { q: 'Welcher ist ein typischer Nachteil eines Robotik-Lagers?', options: ['Es braucht keinerlei Wartung', 'Hohe Investition und starke Abhängigkeit von IT und Technik', 'Es kann nur Paletten lagern', 'Die Picker müssen sehr weit laufen'], correct: 1, explain: 'Die Anlage kostet viel Geld und funktioniert nur mit zuverlässiger IT. Fällt das System aus, steht das ganze Lager.' },
  { q: 'Was bedeutet „Opportunity Charging“?', options: ['Roboter laden nur nachts', 'Roboter laden zwischendurch kurz in ruhigen Phasen', 'Der Picker lädt die Roboter per Kabel', 'Roboter tauschen Akkus untereinander'], correct: 1, explain: 'Statt langer Ladepausen nutzen die Roboter Leerlaufzeiten zum Nachladen – so bleiben genug Roboter einsatzbereit.' },
  { q: 'Welche Aufgabe bleibt in diesem Lager vor allem beim Menschen?', options: ['Die Roboter fernzusteuern', 'Die Regale selbst zu schieben', 'Unterschiedlichste Artikel greifen, prüfen und Ausnahmen wie Fehlteile lösen', 'Die Bodencodes zu reinigen'], correct: 2, explain: 'Greifen und Urteilen kann der Mensch (noch) besser als Roboter. Seine Rolle verschiebt sich vom Laufen zum Prüfen, Lösen und Überwachen.' },
];
