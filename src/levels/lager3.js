// LAGER 03 – Fulfillment-Center „Paketwerk“
// Durchlaufregale · Pick-by-Light · Multi-Order-Picking (Pick & Sort) · Put-to-Light am Wagen · Verpacken & Versand
import * as THREE from 'three';
import { buildHall, setupLighting, captureEnvironment, bakeFloorAO, floorLines, boxGeo, mergeToMesh } from '../core/env.js';
import { Atlas, AtlasInstances, ModelInstances, atlasInstancedMaterial, signMesh, labelStrips } from '../core/builders.js';
import { makeCanvas, drawEAN, signCanvas, FONT, MONO, wrapText, shade, drawIcon } from '../core/canvas.js';
import { Interaction, fitObject, roundRect } from '../core/interaction.js';
import { fmtTime, fmtNum, loadResults } from '../sim/mission.js';
import { groundCenter } from '../core/assets.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeAssortment, BATCH, PACKAGING, fits, fillRate, bestPackaging, volume, CAT_NAMES } from './lager3/catalog.js';
import { TEAL, flowRackRow, toteGeometry, unitBoxFrontUV, ledAtlas, PTLModules, multiOrderCart, rollerConveyor, kiosk, cardboardTexture } from './lager3/parts.js';

const RNG = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
const HALL = { w: 24, d: 20, h: 7 };
const RACK = { x: -5.6, front: 1.0, bays: 5, bayW: 1.2, depth: 1.5, frontYs: [0.42, 0.9, 1.38], rise: 0.16, lanes: 3 };
const SPOTS = {
  spawn: { x: 2.2, z: 1.9, yaw: 1.2 },
  cart: new THREE.Vector3(-0.2, 0, 0.55),
  terminal: new THREE.Vector3(-1.25, 0, -1.75),
  pack: new THREE.Vector3(7.6, 0, 0.2),     // Packtisch-Mitte
  worker: new THREE.Vector3(6.5, 0, 0.2),
  rackShelf: new THREE.Vector3(6.55, 0, -1.5),   // Verpackungsregal: Front nach +Z (Packer dreht sich nach links)
};

export default {
  async build(ctx, { onProgress } = {}) {
    const { engine, mat, assets, ui, audio, player, interaction, root, input } = ctx;
    const hand = interaction.hand;

    // ---------- Modelle
    const PRODUCT_MODELS = ['p_cookies', 'p_juice', 'p_markers', 'p_gloves', 'p_bulb', 'p_glovebox', 'p_helmet', 'p_toolcase'];
    const modelIds = [...PRODUCT_MODELS, 'work_table', 'packing_station_full', 'scanner_stand', 'label_printer', 'monitor_office', 'pallet', 'pallet_load_foil', 'pallet_load_wrapped',
      'box_shipping', 'box_open', 'box_a', 'box_b', 'extinguisher', 'trash_bin', 'lift_table', 'first_aid', 'sign_cone', 'guard_rail', 'conveyor_straight'];
    await assets.preload(modelIds, (p, id) => onProgress && onProgress(p * 0.45, 'Modell: ' + id));

    // ---------- Halle
    const floorMat = mat.pbr('floor_concrete_clean', { repeat: [HALL.w / 3, HALL.d / 3], ao: false, fallbackColor: 0xbfc4c8, roughness: 1, metalness: 1, tag: 'l3floor' });
    const wallMat = mat.pbr('wall_panel_metal', { repeat: [1, 1], color: 0xeef1f4, fallbackColor: 0xdfe3e8, metalness: 0.2, tag: 'l3wall' });
    const lowerMat = mat.pbr('wall_plaster', { repeat: [1, 1], color: 0xf7f8fa, fallbackColor: 0xf1f3f5, metalness: 0, tag: 'l3lower' });
    const ceilMat = mat.pbr('wall_panel_metal', { repeat: [HALL.w / 3, HALL.d / 3], color: 0xc9d1d9, fallbackColor: 0xbac2ca, metalness: 0.3, tag: 'l3ceil' });
    const hall = buildHall(ctx, {
      ...HALL, style: 'modern', floor: floorMat, wall: wallMat, wallTile: 3, ceiling: ceilMat, wallLower: lowerMat, wallLowerH: 2.6,
      trussSpacing: 5, columns: { dx: 8, dz: 6.67, skip: (x, z) => x < 0 || Math.abs(x - 8) < 0.5 }, columnMat: mat.basic(0xe5e7eb, 0.5, 0.3),
      doors: [{ side: 's', at: SPOTS.pack.x, w: 3.0, h: 3.3 }, { side: 's', at: -3.5, w: 3.0, h: 3.3 }],
    });
    // türkises Band an den Wänden
    const band = [
      boxGeo(HALL.w - 0.3, 0.32, 0.03, 0, 2.76, -HALL.d / 2 + 0.17), boxGeo(HALL.w - 0.3, 0.32, 0.03, 0, 2.76, HALL.d / 2 - 0.17),
      boxGeo(0.03, 0.32, HALL.d - 0.3, -HALL.w / 2 + 0.17, 2.76, 0), boxGeo(0.03, 0.32, HALL.d - 0.3, HALL.w / 2 - 0.17, 2.76, 0),
    ];
    root.add(mergeToMesh(band, mat.basic(TEAL, 0.45, 0.1), { cast: false, name: 'band' }));
    // Oberlichter (Lichtbänder im Dach)
    const skyMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xeaf4ff, emissiveIntensity: 1.05 });
    ctx.track(skyMat);
    for (const z of [-5.5, 0, 5.5]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(HALL.w - 4, 1.4), skyMat);
      s.rotation.x = Math.PI / 2; s.position.set(0, HALL.h - 0.02, z);
      root.add(s);
    }
    // Sektionaltore (Versand)
    const doorTex = ctx.track(new THREE.CanvasTexture(sectionalDoorCanvas()));
    doorTex.colorSpace = THREE.SRGBColorSpace;
    for (const x of [SPOTS.pack.x, -3.5]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.3), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.5, metalness: 0.4 }));
      // vor die Sockelverkleidung der Wand setzen (die hat keine Toröffnung)
      d.position.set(x, 1.65, HALL.d / 2 - 0.21); d.rotation.y = Math.PI;
      root.add(d);
      const frame = mergeToMesh([boxGeo(0.12, 3.4, 0.12, x - 1.56, 1.7, HALL.d / 2 - 0.25), boxGeo(0.12, 3.4, 0.12, x + 1.56, 1.7, HALL.d / 2 - 0.25), boxGeo(3.24, 0.14, 0.12, x, 3.4, HALL.d / 2 - 0.25)], mat.basic(0xf2c21b, 0.5, 0.2));
      root.add(frame);
    }

    // ---------- Sortiment & Grafiken
    const laneCount = RACK.bays * RACK.lanes * RACK.frontYs.length * 2;
    const skus = makeAssortment(laneCount);
    // Modelle: auf Artikelmaße skalieren, Maße aus dem Modell übernehmen
    const modelFits = new Map();
    for (const s of skus) {
      if (!s.model || !assets.templates.get(s.model)) { s.model = undefined; continue; }
      if (!modelFits.has(s.model)) {
        const t = assets.get(s.model);
        const holder = new THREE.Group(); holder.add(t);
        fitObject(t, Math.max(...s.dims));
        groundCenter(t);
        const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
        modelFits.set(s.model, { scale: t.scale.x, size });
      }
      const f = modelFits.get(s.model);
      s.dims = [f.size.x, f.size.y, f.size.z];
      s.modelScale = f.scale;
    }
    const packAtlas = new Atlas(ctx, { size: 2048, cellW: 128, cellH: 128 });
    for (const s of skus) s.uv = packAtlas.add(productFront(s));
    const labelAtlas = new Atlas(ctx, { size: 2048, cellW: 256, cellH: 64 });
    const led = ledAtlas(ctx);
    onProgress && onProgress(0.55, 'Durchlaufregale aufbauen …');

    // ---------- Durchlaufregale
    const rows = [
      { id: 'A', rack: flowRackRow(ctx, { x: RACK.x, z: -RACK.front, ry: 0, bays: RACK.bays, bayW: RACK.bayW, depth: RACK.depth, frontYs: RACK.frontYs, rise: RACK.rise, lanesPerBay: RACK.lanes }) },
      { id: 'B', rack: flowRackRow(ctx, { x: RACK.x, z: RACK.front, ry: Math.PI, bays: RACK.bays, bayW: RACK.bayW, depth: RACK.depth, frontYs: RACK.frontYs, rise: RACK.rise, lanesPerBay: RACK.lanes }) },
    ];
    const footprints = rows.map(r => ({ ...r.rack.footprint, s: 0.45, blur: 0.3 }));
    // Zuordnung Artikel → Fach (gemischt, Batch-Artikel verteilt)
    const rnd = RNG(20261121);
    const order = skus.map((s, i) => i).sort(() => rnd() - 0.5);
    const toteGeo = toteGeometry(0.36, 0.16, 0.46); ctx.track(toteGeo);
    const toteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0 }); ctx.track(toteMat);
    const totes = new THREE.InstancedMesh(toteGeo, toteMat, laneCount * 3);
    totes.count = 0; totes.castShadow = true; totes.receiveShadow = true;
    const unitGeo = unitBoxFrontUV(); ctx.track(unitGeo);
    const unitMat = atlasInstancedMaterial(packAtlas.texture, { roughness: 0.6 }); ctx.track(unitMat);
    const units = new AtlasInstances(unitGeo, unitMat, laneCount * 14);
    const modelPools = new Map();
    const ptl = new PTLModules(ctx, led, laneCount);
    const lanes = [];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
    const toteColors = [new THREE.Color(0x5b6b7c), new THREE.Color(0x1f6fb2), new THREE.Color(0x5b6b7c)];
    let k = 0;
    for (const row of rows) {
      const rack = row.rack;
      const g = rack.group;
      const labels = [];
      for (const ln of rack.lanes) {
        const sku = skus[order[k]];
        const n = (ln.level - 1) * RACK.bays * RACK.lanes + (ln.bay - 1) * RACK.lanes + ln.lane;
        const code = `${row.id}-${String(n).padStart(2, '0')}`;
        const lane = { code, row: row.id, ...ln, sku, stock: 6 + Math.floor(rnd() * 8), unitIdx: [], remaining: 0, state: 'off', group: g };
        sku.lane = lane;
        lanes.push(lane);
        k++;
        // Behälter: vorne geneigt (Pickposition), dahinter zwei Nachschubbehälter
        const ang = ln.angle;
        for (let t = 0; t < 3; t++) {
          const zc = -0.26 - t * 0.48;
          const y = ln.frontY + RACK.rise * (-zc / RACK.depth) + 0.004;
          const tilt = t === 0 ? ang + 0.16 : ang;
          M.compose(P.set(ln.x, y, zc), Q.setFromEuler(E.set(tilt, 0, 0)), S.set(1, 1, 1));
          M.premultiply(g.matrixWorld);
          totes.setMatrixAt(totes.count, M);
          totes.setColorAt(totes.count, toteColors[t]);
          totes.count++;
          if (t === 0) lane.toteMatrix = M.clone();
          // Ware im Behälter
          const [w, h, d] = sku.dims;
          const lay = h > 0.24;                  // hohe Artikel liegen
          const fw = Math.min(w, 0.33), fh = lay ? d : h, fd = lay ? h : d;
          const cols = fw <= 0.155 ? 2 : 1;
          const per = Math.max(1, Math.min(4, Math.floor(0.42 / (fd + 0.012))));
          const useModel = t === 0 && sku.model;
          // Modelle sind detailreich → höchstens 3 sichtbar (Performance auf der Quest)
          const count = t === 0 ? Math.min(lane.stock, cols * per, useModel ? 3 : 99) : Math.min(2, cols * per);
          for (let i = 0; i < count; i++) {
            const c = i % cols, r = Math.floor(i / cols);
            const px = cols === 2 ? (c - 0.5) * (fw + 0.01) : 0;
            const pz = 0.2 - fd / 2 - r * (fd + 0.012);
            const um = new THREE.Matrix4();
            if (useModel) {
              um.compose(P.set(px, 0.01, pz), Q.setFromEuler(E.set(lay ? -Math.PI / 2 : 0, 0, 0)), S.setScalar(1));
            } else {
              um.compose(P.set(px, 0.01 + fh / 2, pz), Q.setFromEuler(E.set(lay ? -Math.PI / 2 : 0, 0, 0)), lay ? S.set(fw, h, d) : S.set(fw, fh, fd));
            }
            const world = M.clone().multiply(um);
            if (useModel) {
              if (!modelPools.has(sku.model)) {
                const tpl = assets.get(sku.model);
                const holder = new THREE.Group(); holder.add(tpl);
                tpl.scale.setScalar(sku.modelScale); groundCenter(tpl);
                modelPools.set(sku.model, new ModelInstances(holder, 40));
              }
              lane.unitIdx.push({ model: modelPools.get(sku.model), i: modelPools.get(sku.model).add(world) });
            } else {
              const idx = units.add(world, sku.uv);
              if (t === 0) lane.unitIdx.push({ atlas: true, i: idx });
            }
          }
        }
        // Pick-to-Light-Modul + Etikett
        M.makeTranslation(ln.x + 0.07, ln.frontY - 0.035, 0.04).premultiply(g.matrixWorld);
        lane.ptl = ptl.add(M.clone());
        labels.push({ local: new THREE.Vector3(ln.x - 0.11, ln.frontY - 0.035, 0.026), depth: 0, uv: labelAtlas.add(laneLabel(code, sku)), ww: 0.15, hh: 0.052 });
        // Trefferbox
        const hb = Interaction.hitBox(ln.width - 0.03, 0.34, 0.5);
        hb.position.set(ln.x, ln.frontY + 0.08, -0.2);
        hb.rotation.x = ln.angle;
        g.add(hb);
        lane.target = interaction.add({
          object: hb, kind: 'bin', maxDistXR: 2.4, maxDist: 2.8,
          label: () => `${code} · ${sku.name}`,
          sub: () => laneSub(lane),
          onPrimary: () => laneClick(lane),
          onSecondary: () => laneReturn(lane),
        });
      }
      labelStrips(ctx, g, labels, labelAtlas.texture, { yOff: 0, inset: 0.001 });
      // Zonenschild am Kopfträger
      for (const sx of [-rack.width / 2 + 0.7, rack.width / 2 - 0.7]) {
        const zs = signMesh(ctx, signCanvas(`Zone ${row.id}`, { sub: 'Pick-by-Light', bg: '#0f766e', fg: '#ffffff', w: 512, h: 160, radius: 12 }), 0.9, 0.28);
        zs.position.set(sx, 2.13, -0.02);
        g.add(zs);
      }
    }
    totes.instanceMatrix.needsUpdate = true; totes.instanceColor.needsUpdate = true; totes.computeBoundingSphere();
    root.add(totes);
    units.finish(); units.mesh.castShadow = false; root.add(units.mesh);
    for (const pool of modelPools.values()) { pool.finish(); pool.group.traverse(o => { if (o.isMesh) o.castShadow = false; }); root.add(pool.group); }
    ptl.finish(); root.add(ptl.group);
    const skuByName = name => skus.find(s => s.shortName === name || s.name === name);

    // Nachschubgänge hinter den Regalen (Deko)
    const backTotes = [], palletSpots = [];
    for (const zz of [-3.55, 3.55]) {
      for (let i = 0; i < 4; i++) {
        const x = -8.2 + i * 1.75;
        palletSpots.push({ x, y: 0, z: zz, ry: Math.PI / 2 });
        for (let s = 0; s < 3 + (i % 2); s++) backTotes.push({ x, y: 0.15 + s * 0.165, z: zz });
      }
    }
    if (assets.templates.get('pallet')) root.add(assets.instanced('pallet', palletSpots));
    const btInst = new THREE.InstancedMesh(toteGeo, toteMat, backTotes.length);
    backTotes.forEach((b, i) => { btInst.setMatrixAt(i, M.makeTranslation(b.x, b.y, b.z)); btInst.setColorAt(i, toteColors[i % 3]); });
    btInst.instanceColor.needsUpdate = true; btInst.castShadow = true; btInst.receiveShadow = true;
    root.add(btInst);
    for (const zz of [-3.55, 3.55]) { player.addBoxCentered(-5.6, zz, 7.2, 0.9, 0, 'nachschub'); footprints.push({ x: -5.6, z: zz, w: 7.2, d: 0.9, s: 0.35, blur: 0.25 }); }

    // ---------- Multi-Order-Wagen
    ui.device.resize(600, 880);
    const cartParts = multiOrderCart(ctx, led, ui.device.texture);
    const cart = cartParts.group;
    cart.position.copy(SPOTS.cart);
    cart.rotation.y = Math.PI / 2;
    root.add(cart);
    let cartCollider = player.addCircle(cart.position.x, cart.position.z, 0.48, 'cart');
    let towing = false;
    const cartHit = Interaction.hitBox(0.96, 0.4, 0.2);
    cartHit.position.set(0, 1.1, 0.36); cart.add(cartHit);
    interaction.add({
      object: cartHit, kind: 'button', color: 0x34d399, label: 'Multi-Order-Wagen', priority: 0,
      sub: () => towing ? 'folgt dir · F: abstellen' : 'Klicken oder F: mitnehmen',
      onPrimary: () => toggleTow(),
      visibleCheck: () => hand.empty,
    });
    const toteState = cartParts.totes.map((t, i) => ({ ...t, flash: 0, orderIdx: i }));
    for (const t of toteState) {
      // flache Trefferfläche an der Behälter-Front (inkl. Put-Light): verdeckt den Behälter darunter nicht
      const hb = Interaction.hitBox(0.29, 0.25, 0.07);
      hb.position.set(t.pos.x, t.pos.y + 0.085, t.pos.z + 0.2);
      cart.add(hb);
      t.target = interaction.add({
        object: hb, kind: 'container', color: 0x34d399, maxDistXR: 2.2,
        priority: () => (!hand.empty || phase === 'packing') ? 2 : 0,
        visibleCheck: () => !hand.empty || phase === 'packing',
        label: () => `Behälter ${t.index + 1} · Auftrag ${orders[t.index].no}`,
        sub: () => toteSub(t),
        onPrimary: () => toteClick(t),
        onSecondary: () => toteUndo(t),
      });
    }
    function toggleTow() {
      if (towing) {
        towing = false;
        cartCollider = player.addCircle(cart.position.x, cart.position.z, 0.48, 'cart');
        audio.play('click');
        ui.toast('Wagen abgestellt.', 'info', 1400);
      } else {
        const hp = engine.headPosition(new THREE.Vector3());
        if (Math.hypot(hp.x - cart.position.x, hp.z - cart.position.z) > 2.6) { ui.toast('Geh näher an den Wagen (F zum Mitnehmen).', 'warn'); return; }
        towing = true;
        player.removeCollider(cartCollider);
        audio.play('click');
        if (!state.towHint) { state.towHint = true; ui.toast('Der Wagen **folgt dir** jetzt (F: abstellen). Er bleibt im Gang neben dir stehen.', 'ok', 4200); }
      }
      updateObjective();
    }
    const onCartKey = () => { if (input.gameActive && !ui.panelOpen) toggleTow(); };
    input.addEventListener('cart', onCartKey);
    // Wagen folgt "an der Leine": bleibt stehen, bis du > 1,35 m entfernt bist
    const _hp = new THREE.Vector3();
    function updateCart(dt) {
      if (!towing) return;
      engine.headPosition(_hp);
      const dx = cart.position.x - _hp.x, dz = cart.position.z - _hp.z;
      const dist = Math.hypot(dx, dz);
      const L = 1.35;
      if (dist > L) {
        const k = 1 - Math.exp(-dt * 8);
        const tx = _hp.x + dx / dist * L, tz = _hp.z + dz / dist * L;
        cart.position.x += (tx - cart.position.x) * k;
        cart.position.z += (tz - cart.position.z) * k;
      } else if (dist < 0.95) {
        // Spieler läuft in den Wagen: Wagen weicht aus (bleibt erreichbar statt "unter" dem Spieler)
        let ux = dx, uz = dz;
        if (dist < 1e-3) { const yaw = engine.headYaw(); ux = Math.sin(yaw); uz = Math.cos(yaw); }
        const n = Math.hypot(ux, uz) || 1;
        const k = 1 - Math.exp(-dt * 10);
        cart.position.x += (_hp.x + ux / n * 0.95 - cart.position.x) * k;
        cart.position.z += (_hp.z + uz / n * 0.95 - cart.position.z) * k;
      }
      // Bügel/Put-Lights zeigen immer zum Spieler (auch im Stand), damit alle Behälter gut erreichbar sind
      if (dist > 0.85) {
        const target = Math.atan2(-dx, -dz);
        let d = target - cart.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        cart.rotation.y += d * (1 - Math.exp(-dt * 4));
      }
      // nicht in Regale/Wände schieben
      const r = 0.46;
      for (const b of player.boxes) {
        const cx = Math.max(b.minX, Math.min(cart.position.x, b.maxX)), cz = Math.max(b.minZ, Math.min(cart.position.z, b.maxZ));
        const ex = cart.position.x - cx, ez = cart.position.z - cz, d2 = ex * ex + ez * ez;
        if (d2 < r * r && d2 > 1e-8) { const d = Math.sqrt(d2); cart.position.x += ex / d * (r - d); cart.position.z += ez / d * (r - d); }
      }
    }

    // ---------- Batch-Terminal
    const kioskCanvas = makeCanvas(640, 440);
    const kioskTex = ctx.track(new THREE.CanvasTexture(kioskCanvas)); kioskTex.colorSpace = THREE.SRGBColorSpace;
    const term = kiosk(ctx, kioskTex);
    term.position.copy(SPOTS.terminal); term.rotation.y = 0.75;
    root.add(term);
    player.addCircle(SPOTS.terminal.x, SPOTS.terminal.z, 0.3, 'terminal');
    if (assets.templates.get('scanner_stand')) { const sc = assets.get('scanner_stand'); fitObject(sc, 0.2); const h = new THREE.Group(); h.add(sc); groundCenter(sc); h.position.set(0.17, 0.94, 0.05); term.add(h); }
    const termHit = Interaction.hitBox(0.6, 1.5, 0.5); termHit.position.set(0, 0.8, 0); term.add(termHit);
    interaction.add({
      object: termHit, kind: 'button', color: 0x2dd4bf, maxDist: 3,
      label: 'Batch-Terminal', sub: () => phase === 'start' ? 'Wagen anmelden & Batch starten' : `Batch ${BATCH.no} läuft`,
      onPrimary: () => startBatch(),
    });

    // ---------- Packstation
    const pack = buildPackStation();
    footprints.push({ x: SPOTS.pack.x, z: SPOTS.pack.z, w: 0.9, d: 1.9, s: 0.4, blur: 0.25 });

    // ---------- Fördertechnik im Hintergrund
    const north = rollerConveyor(ctx, [new THREE.Vector3(-11.2, 0, -8.7), new THREE.Vector3(10.7, 0, -8.7), new THREE.Vector3(10.7, 0, -2.4)]);
    player.addBox(-11.6, -9.2, 11.2, -8.2, 'conv'); player.addBox(10.2, -9.2, 11.2, -2.0, 'conv');
    footprints.push({ x: 0, z: -8.7, w: 22, d: 0.8, s: 0.3, blur: 0.2 }, { x: 10.7, z: -5.5, w: 0.8, d: 6.6, s: 0.3, blur: 0.2 });
    const flowTotes = new THREE.InstancedMesh(toteGeo, toteMat, 22);
    flowTotes.castShadow = true;
    const flowOffsets = Array.from({ length: 22 }, (_, i) => i * north.length / 22 + rnd() * 0.4);
    flowOffsets.forEach((o, i) => flowTotes.setColorAt(i, toteColors[i % 3]));
    flowTotes.instanceColor.needsUpdate = true;
    root.add(flowTotes);
    const motor = new THREE.Object3D(); motor.position.set(0, 1, -8.7); root.add(motor);
    let flowS = 0;
    ctx.onUpdate(dt => {
      flowS += dt * 0.55;
      for (let i = 0; i < flowOffsets.length; i++) {
        const p = north.pointAt(flowS + flowOffsets[i], P);
        M.compose(P.set(p.x, p.y + 0.02, p.z), Q.setFromEuler(E.set(0, p.ang, 0)), S.set(1, 1, 1));
        flowTotes.setMatrixAt(i, M);
      }
      flowTotes.instanceMatrix.needsUpdate = true;
      north.rollerMap.offset.y -= dt * 0.55 / 0.1;
      pack.outRoller.offset.y -= dt * 0.6 / 0.1;
    });
    flowTotes.computeBoundingSphere();
    flowTotes.frustumCulled = false;

    // ---------- Wandgrafiken, Schilder, Deko
    const logo = signMesh(ctx, logoCanvas(), 10, 2.5, { emissive: 0.15 });
    logo.position.set(-HALL.w / 2 + 0.17, 4.6, 0); logo.rotation.y = Math.PI / 2;
    root.add(logo);
    const dashCanvas = makeCanvas(1024, 512);
    const dash = signMesh(ctx, dashCanvas, 4.4, 2.2, { emissive: 0.9 });
    dash.position.set(1.5, 4.7, -HALL.d / 2 + 0.17);
    root.add(dash);
    let dashT = 0, shippedToday = 12480;
    ctx.onUpdate(dt => { dashT -= dt; if (dashT <= 0) { dashT = 2; shippedToday += Math.floor(Math.random() * 4); drawDashboard(dashCanvas, shippedToday); dash.material.map.needsUpdate = true; } });
    const cableGeos = [];
    const hang = (text, sub, x, y, z, ry, w = 2.2) => {
      const s = signMesh(ctx, signCanvas(text, { sub, bg: '#0f172a', fg: '#ffffff', w: 1024, h: 256 }), w, w / 4);
      s.position.set(x, y, z); s.rotation.y = ry; root.add(s);
      for (const dx of [-w * 0.42, w * 0.42]) {
        const cg = new THREE.CylinderGeometry(0.004, 0.004, HALL.h - y - w / 8, 4);
        cg.translate(x + Math.cos(ry) * dx, (HALL.h + y + w / 8) / 2, z - Math.sin(ry) * dx);
        cableGeos.push(cg);
      }
    };
    hang('PICKZONE', 'Pick-by-Light · Multi-Order', -2.3, 3.3, 0, Math.PI / 2);
    hang('PACKEN', 'Packstation 1 · Versand', SPOTS.pack.x - 0.3, 3.3, SPOTS.pack.z, -Math.PI / 2);
    hang('VERSAND', 'Tor 1 · Paketdienst', SPOTS.pack.x, 3.9, 8.2, Math.PI);
    hang('RETOUREN', 'Rücksendungen prüfen', -10.3, 3.3, 5.6, Math.PI / 2, 2.0);
    hang('NACHSCHUB', 'Befüllung von hinten', -9.4, 3.0, -3.55, Math.PI / 2, 1.8);
    hang('WARENEINGANG', 'Anlieferung · Einlagerung', -6.5, 3.3, 8.0, Math.PI, 2.2);
    root.add(mergeToMesh(cableGeos, mat.basic(0x334155, 0.5, 0.6), { cast: false, name: 'cables' }));
    // Wareneingang (Südwest): angelieferte Paletten
    for (const [id, x, z, ry] of [['pallet_load_wrapped', -8.6, 7.6, 0.05], ['pallet_load_foil', -6.9, 7.8, -0.1], ['pallet_load_wrapped', -5.1, 7.5, 0.12]]) {
      if (!assets.templates.get(id)) continue;
      const o = assets.get(id); o.position.set(x, 0, z); o.rotation.y = ry; root.add(o);
      const s = assets.size(id); player.addCircle(x, z, Math.max(s.x, s.z) * 0.5, id);
      footprints.push({ x, z, w: s.x * 0.95, d: s.z * 0.95, s: 0.45, blur: 0.2 });
    }
    // Bodenmarkierungen
    floorLines(ctx, [
      { x1: -9, z1: -0.95, x2: -2.5, z2: -0.95, w: 0.08 }, { x1: -9, z1: 0.95, x2: -2.5, z2: 0.95, w: 0.08 },
      { x1: -2.2, z1: -9.2, x2: -2.2, z2: 9.5, w: 0.1 }, { x1: 5.6, z1: -3.0, x2: 5.6, z2: 3.4, w: 0.1 },
      { x1: 5.6, z1: -3.0, x2: 9.6, z2: -3.0, w: 0.1 }, { x1: 5.6, z1: 3.4, x2: 6.9, z2: 3.4, w: 0.1 },
    ], { color: 0xf2c21b, roughness: 0.5 });
    floorLines(ctx, [{ x1: -1.8, z1: 2.3, x2: 5.2, z2: 2.3, w: 0.08 }, { x1: -1.8, z1: -2.3, x2: 5.2, z2: -2.3, w: 0.08 }], { color: 0x16a34a, roughness: 0.5 });
    // Retouren-Ecke
    const retTable = assets.get('work_table', { fallbackSize: [1.6, 0.9, 0.8] });
    retTable.position.set(-10.6, 0, 3.8); retTable.rotation.y = Math.PI / 2; root.add(retTable);
    player.addBoxCentered(-10.6, 3.8, 0.9, 1.7, 0, 'ret');
    footprints.push({ x: -10.6, z: 3.8, w: 0.9, d: 1.7, s: 0.35, blur: 0.25 });
    const retTop = assets.templates.get('work_table') ? assets.size('work_table').y : 0.9;
    for (const [id, dz] of [['box_open', 3.4], ['box_a', 4.3]]) { if (!assets.templates.get(id)) continue; const b = assets.get(id); fitObject(b, 0.4); const h = new THREE.Group(); h.add(b); groundCenter(b); h.position.set(-10.6, retTop, dz); root.add(h); }
    for (const [id, x, z, ry] of [['pallet_load_wrapped', -10.4, 5.9, 0.2], ['pallet_load_foil', -10.4, -6.2, 0.1], ['extinguisher', -2.0, -9.5, 0], ['trash_bin', 5.2, 3.1, 0.4], ['lift_table', -1.6, -3.6, 1.2], ['sign_cone', -1.9, 2.7, 0]]) {
      if (!assets.templates.get(id)) continue;
      const o = assets.get(id); o.position.set(x, 0, z); o.rotation.y = ry; root.add(o);
      if (['extinguisher', 'trash_bin', 'sign_cone'].includes(id)) o.traverse(m => { if (m.isMesh) m.castShadow = false; });
      const s = assets.size(id); player.addCircle(x, z, Math.max(s.x, s.z) * 0.45, id);
      footprints.push({ x, z, w: s.x * 0.9, d: s.z * 0.9, s: 0.35, blur: 0.2 });
    }
    if (assets.templates.get('first_aid')) { const fa = assets.get('first_aid'); fa.position.set(HALL.w / 2 - 0.15, 1.4, -4.5); fa.rotation.y = -Math.PI / 2; root.add(fa); }

    // ---------- Aufträge & Zustand
    const orders = BATCH.orders.map((o, i) => ({
      ...o, idx: i,
      lines: o.lines.map(([name, qty]) => ({ sku: skuByName(name), qty, put: 0, done: false })),
      packed: false, choice: null, best: null, fill: 0,
    }));
    for (const o of orders) for (const l of o.lines) if (!l.sku) console.warn('Artikel fehlt im Sortiment', l);
    const totalUnits = orders.reduce((s, o) => s + o.lines.reduce((a, l) => a + l.qty, 0), 0);
    const totalLines = orders.reduce((s, o) => s + o.lines.length, 0);
    let phase = 'start';
    const state = { taken: 0, put: 0, errors: { wrong_bin: 0, wrong_tote: 0, wrong_qty: 0 }, packedCount: 0, towHint: false, batchStart: 0, pickEnd: 0, packStart: 0, packTooSmall: 0, packWasteful: 0 };

    // ---------- Pick-by-Light-Logik
    function laneSub(lane) {
      if (phase !== 'picking') return `Art.-Nr. ${lane.sku.art} · ${CAT_NAMES[lane.sku.cat]}`;
      if (lane.state === 'active') {
        if (lane.remaining > 0) return hand.empty || hand.sku === lane.sku.id ? `Leuchtet: ${lane.remaining} Stück entnehmen` : 'Erst die Ware in der Hand ablegen';
        return hand.sku === lane.sku.id ? 'In den leuchtenden Behälter legen' : 'OK – Taste drücken (Klick) zum Quittieren';
      }
      return 'Kein Licht – hier nichts entnehmen';
    }
    function refreshLane(lane) {
      const i = lane.ptl;
      if (lane.flash > 0) return;
      if (lane.state === 'active') {
        if (lane.remaining > 0) { ptl.setDisplay(i, lane.remaining); ptl.setButton(i, 'green'); }
        else if (hand.sku === lane.sku.id) { ptl.setDisplay(i, '--'); ptl.setButton(i, 'green'); }
        else { ptl.setDisplay(i, 'OK'); ptl.setButton(i, lane.blink ? 'green' : 'dim'); }
      } else { ptl.setDisplay(i, 0); ptl.setButton(i, 'off'); }
    }
    function flashLane(lane) { lane.flash = 0.9; ptl.setDisplay(lane.ptl, 'E'); ptl.setButton(lane.ptl, 'red'); }
    function laneClick(lane) {
      if (phase === 'start') { ui.toast('Erst den Wagen am **Batch-Terminal** anmelden – dann leuchten die Fächer.', 'warn'); return; }
      if (phase !== 'picking') { ui.toast('Alle Teile sind kommissioniert. Weiter zur **Packstation**.', 'info'); return; }
      const m = ctx.currentMission;
      if (lane.state !== 'active') {
        state.errors.wrong_bin++; m && m.error('wrong_bin', `${lane.code} ${lane.sku.name}`);
        flashLane(lane);
        ui.toast('**Falsches Fach!** Hier leuchtet kein Licht. Pick-by-Light zeigt dir genau, wo du greifen sollst.', 'error', 3600);
        return;
      }
      if (lane.remaining <= 0) {
        if (hand.sku === lane.sku.id) { ui.toast('Leg die Teile aus der Hand erst in die leuchtenden Behälter.', 'warn'); return; }
        confirmLane(lane);
        return;
      }
      if (!hand.empty && hand.sku !== lane.sku.id) { ui.toast('Deine Hand ist voll – leg die Ware erst in den leuchtenden **Behälter am Wagen**.', 'warn'); audio.play('warn'); return; }
      lane.remaining--;
      lane.stock--;
      hideUnit(lane);
      hand.take(lane.sku.id, lane.sku.name, 1, () => makeUnitMesh(lane.sku), { skuObj: lane.sku, lane, handSize: 0.16 });
      state.taken++;
      m && m.pick(1);
      audio.play('pick');
      refreshLane(lane); refreshCart(); drawCartScreen();
    }
    function laneReturn(lane) {
      if (phase !== 'picking' || hand.empty || hand.sku !== lane.sku.id) { if (!hand.empty) ui.toast('Das gehört nicht in dieses Fach.', 'warn'); return; }
      hand.give(1);
      lane.remaining++; lane.stock++; state.taken--;
      showUnit(lane);
      audio.play('put');
      refreshLane(lane); refreshCart(); drawCartScreen();
    }
    function confirmLane(lane) {
      lane.state = 'done';
      audio.play('button');
      ptl.setDisplay(lane.ptl, 0); ptl.setButton(lane.ptl, 'off');
      checkPickingDone();
      drawCartScreen();
    }
    function hideUnit(lane) {
      const vis = lane.unitIdx.filter(u => !u.hidden);
      if (vis.length > lane.stock && vis.length) { const u = vis[vis.length - 1]; u.hidden = true; if (u.atlas) units.setVisible(u.i, false); else u.model.setVisible(u.i, false); }
    }
    function showUnit(lane) {
      const hid = lane.unitIdx.filter(u => u.hidden);
      if (hid.length) { const u = hid[0]; u.hidden = false; if (u.atlas) units.setVisible(u.i, true); else u.model.setVisible(u.i, true); }
    }

    // ---------- Put-to-Light am Wagen
    function toteNeed(t, skuId) { const l = orders[t.index].lines.find(x => x.sku.id === skuId); return l ? l.qty - l.put : 0; }
    function orderComplete(o) { return o.lines.every(l => l.put >= l.qty); }
    const lastDisp = [], lastBtn = [];
    function setTote(i, v, rgb) {
      if (lastDisp[i] !== v) { lastDisp[i] = v; cartParts.setDisplay(i, v); }
      const key = rgb.join(',');
      if (lastBtn[i] !== key) { lastBtn[i] = key; cartParts.setButton(i, rgb); }
    }
    function refreshCart() {
      for (const t of toteState) {
        if (t.flash > 0) continue;
        const o = orders[t.index];
        const need = hand.empty ? 0 : toteNeed(t, hand.sku);
        if (phase === 'packing') setTote(t.index, o.packed ? 0 : '✓', o.packed ? [0.05, 0.05, 0.05] : [0.1, 1.6, 0.6]);
        else if (need > 0) setTote(t.index, need, [0.15, 3.2, 0.9]);
        else if (orderComplete(o)) setTote(t.index, 'OK', [0.05, 0.6, 0.25]);
        else setTote(t.index, 0, [0.05, 0.05, 0.05]);
      }
    }
    function flashTote(t) { t.flash = 0.9; setTote(t.index, 'E', [3.2, 0.25, 0.2]); }
    function toteSub(t) {
      const o = orders[t.index];
      if (phase === 'packing') return o.packed ? 'bereits verpackt' : (packState.order ? 'Packtisch ist belegt' : 'Klicken: auf den Packtisch');
      if (hand.empty) return `${o.customer} · ${o.lines.reduce((s, l) => s + l.put, 0)}/${o.lines.reduce((s, l) => s + l.qty, 0)} Teile`;
      const need = toteNeed(t, hand.sku);
      return need > 0 ? `Leuchtet: ${need} hineinlegen` : 'Kein Licht – gehört hier nicht hinein';
    }
    function toteClick(t) {
      if (phase === 'packing') { pack.takeOrder(t); return; }
      if (hand.empty) return;
      const m = ctx.currentMission;
      const need = toteNeed(t, hand.sku);
      if (need <= 0) {
        state.errors.wrong_tote++; m && m.error('wrong_tote', `${hand.item.skuObj.name} → Behälter ${t.index + 1}`);
        flashTote(t);
        ui.toast('**Falscher Behälter!** Leg die Ware nur in den Behälter, dessen Licht leuchtet.', 'error', 3600);
        return;
      }
      const sku = hand.item.skuObj;
      const lane = hand.item.lane;
      const kk = Math.min(hand.count, need);
      const line = orders[t.index].lines.find(x => x.sku.id === sku.id);
      line.put += kk;
      hand.give(kk);
      for (let i = 0; i < kk; i++) addToTote(t, sku);
      state.put += kk;
      audio.play('put');
      if (line.put >= line.qty && !line.done) { line.done = true; m && m.line(1); }
      if (orderComplete(orders[t.index])) { audio.play('ok'); ui.toast(`Auftrag ${orders[t.index].no} vollständig ✓`, 'ok', 2200); }
      if (lane) refreshLane(lane);
      refreshCart(); drawCartScreen(); checkPickingDone();
    }
    function toteUndo(t) {
      if (phase !== 'picking' || !t.items.length) return;
      const last = t.items[t.items.length - 1];
      if (!hand.empty && hand.sku !== last.sku.id) { ui.toast('Hand ist voll.', 'warn'); return; }
      t.items.pop(); cart.remove(last.mesh);
      const line = orders[t.index].lines.find(x => x.sku.id === last.sku.id);
      line.put--; if (line.done) { line.done = false; const m = ctx.currentMission; if (m) m.lines = Math.max(0, m.lines - 1); }
      hand.take(last.sku.id, last.sku.name, 1, () => makeUnitMesh(last.sku), { skuObj: last.sku, lane: last.sku.lane, handSize: 0.16 });
      state.put--;
      audio.play('pick');
      if (last.sku.lane) refreshLane(last.sku.lane);
      refreshCart(); drawCartScreen();
    }
    function addToTote(t, sku) {
      const m = makeUnitMesh(sku);
      fitObject(m, 0.11);
      const holder = new THREE.Group(); holder.add(m);
      const i = t.items.length;
      holder.position.set(t.pos.x + ((i % 2) - 0.5) * 0.1, t.pos.y + 0.06 + Math.floor(i / 4) * 0.05, t.pos.z + (Math.floor(i / 2) % 2 - 0.5) * 0.16);
      holder.rotation.y = (i * 1.3) % 1 - 0.5;
      cart.add(holder);
      t.items.push({ sku, mesh: holder });
    }

    function startBatch() {
      if (phase !== 'start') { ui.toast(`Batch ${BATCH.no} läuft bereits.`, 'info'); return; }
      if (cart.position.distanceTo(SPOTS.terminal) > 2.8) { ui.toast('Bring den **Wagen** zum Terminal – er wird hier per Barcode angemeldet.', 'warn', 3600); return; }
      phase = 'picking';
      state.batchStart = ctx.currentMission ? ctx.currentMission.elapsed : 0;
      audio.play('scan'); setTimeout(() => audio.play('ok'), 160);
      const need = new Map();
      for (const o of orders) for (const l of o.lines) need.set(l.sku.id, (need.get(l.sku.id) || 0) + l.qty);
      for (const lane of lanes) {
        const n = need.get(lane.sku.id);
        if (n) { lane.state = 'active'; lane.remaining = n; } else { lane.state = 'off'; lane.remaining = 0; }
        refreshLane(lane);
      }
      drawKiosk(); drawCartScreen(); refreshCart(); updateObjective();
      ui.toast(`Batch **${BATCH.no}** gestartet: **6 Aufträge**, ${totalUnits} Teile. Folge den Lichtern!`, 'ok', 4500);
    }
    function checkPickingDone() {
      if (phase !== 'picking') return;
      const allPut = orders.every(orderComplete);
      const allConfirmed = lanes.every(l => l.state !== 'active');
      if (allPut && allConfirmed) {
        phase = 'toPack';
        state.pickEnd = ctx.currentMission ? ctx.currentMission.elapsed : 0;
        state.pickDist = player.distance;
        audio.play('complete');
        ui.toast('**Batch komplett!** Alle 6 Aufträge sind im Wagen. Bring ihn zur **Packstation** (rechts).', 'ok', 5000);
        refreshCart(); updateObjective();
      } else if (allPut && !allConfirmed && !state.confirmHint) {
        state.confirmHint = true;
        ui.toast('Alle Teile liegen im Wagen – **quittiere** noch die Fächer, die **OK** zeigen (anklicken).', 'info', 4500);
      }
      updateObjective();
    }

    // ---------- Packen
    const packState = { order: null, tote: null, items: [], box: null, step: 'idle', label: null };
    function buildPackStation() {
      const T = SPOTS.pack;
      const tbl = assets.get('work_table', { fallbackSize: [1.8, 0.9, 0.8], color: 0xd8dde2 });
      const tSize = assets.templates.get('work_table') ? assets.size('work_table') : new THREE.Vector3(1.8, 0.9, 0.8);
      // Arbeitsseite nach −X (Packer steht westlich)
      const info = assets.info('work_table');
      tbl.rotation.y = faceRotation(info && info.front, '-X', tSize);
      tbl.position.copy(T);
      root.add(tbl);
      const along = Math.max(tSize.x, tSize.z), across = Math.min(tSize.x, tSize.z);
      const top = tSize.y > 0.5 && tSize.y < 1.2 ? tSize.y : 0.9;
      player.addBoxCentered(T.x, T.z, across, along, 0, 'packtable');
      // Bildschirm
      const scrCanvas = makeCanvas(1024, 640);
      const scrTex = ctx.track(new THREE.CanvasTexture(scrCanvas)); scrTex.colorSpace = THREE.SRGBColorSpace;
      const mon = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.04), mat.basic(0x111418, 0.4, 0.3));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.36), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }));
      scr.position.z = 0.021;
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), mat.basic(0x2b3038, 0.5, 0.4)); stand.position.set(0, -0.32, -0.02);
      mon.add(frame, scr, stand);
      mon.position.set(T.x + across / 2 - 0.12, top + 0.5, T.z - 0.15); mon.rotation.y = -Math.PI / 2;
      root.add(mon);
      // Etikettendrucker
      let printer;
      if (assets.templates.get('label_printer')) { printer = assets.get('label_printer'); const h = new THREE.Group(); fitObject(printer, 0.38); h.add(printer); groundCenter(printer); printer = h; }
      else { printer = mergeToMesh([boxGeo(0.28, 0.22, 0.34, 0, 0.11, 0)], mat.basic(0x2b3038, 0.5, 0.2)); }
      printer.position.set(T.x + 0.12, top, T.z + along / 2 - 0.22); printer.rotation.y = -Math.PI / 2;
      root.add(printer);
      // Handscanner-Station (Deko)
      if (assets.templates.get('scanner_stand')) { const sc = assets.get('scanner_stand'); const h = new THREE.Group(); fitObject(sc, 0.22); h.add(sc); groundCenter(sc); h.position.set(T.x + 0.2, top, T.z - along / 2 + 0.2); root.add(h); }
      // Klebeband / Füllmaterial-Deko
      const tape = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.022, 10, 24), mat.basic(0xc9a46a, 0.6, 0)); tape.rotation.x = Math.PI / 2; tape.position.set(T.x + 0.25, top + 0.022, T.z + 0.45); root.add(tape);
      // Verpackungsregal
      const shelf = new THREE.Group();
      const R = SPOTS.rackShelf;
      const shelfGeos = [boxGeo(0.5, 1.2, 0.04, 0, 0.6, -0.92), boxGeo(0.5, 1.2, 0.04, 0, 0.6, 0.92)];
      for (const y of [0.12, 0.62, 1.12]) shelfGeos.push(boxGeo(0.5, 0.03, 1.88, 0, y, 0));
      for (let i = 1; i < 4; i++) shelfGeos.push(boxGeo(0.5, 0.5, 0.02, 0, 0.37, -0.92 + i * 0.46));
      shelf.add(mergeToMesh(shelfGeos, mat.basic(0xe5e7eb, 0.5, 0.3)));
      const card = new THREE.MeshStandardMaterial({ map: cardboardTexture(), roughness: 0.85 });
      const bagMat = mat.basic(0x9aa3ad, 0.6, 0);
      const stacks = [];
      PACKAGING.forEach((p, i) => {
        const z = -0.69 + i * 0.46;
        const sg = [];
        const n = 7;
        for (let s = 0; s < n; s++) sg.push(boxGeo(p.bag ? 0.34 : 0.38, p.bag ? 0.008 : 0.012, p.bag ? 0.25 : 0.32, 0, 0.14 + s * (p.bag ? 0.01 : 0.014), z));
        const st = mergeToMesh(sg, p.bag ? bagMat : card);
        shelf.add(st);
        // aufgebautes Musterpaket oben
        const d = p.dims;
        const sample = new THREE.Mesh(new THREE.BoxGeometry(p.bag ? 0.3 : d[0] * 0.9, p.bag ? 0.05 : d[2], p.bag ? 0.22 : d[1] * 0.9), p.bag ? bagMat : card);
        sample.position.set(0, 0.635 + (p.bag ? 0.025 : d[2] / 2), z);
        sample.castShadow = true; shelf.add(sample);
        const lbl = signMesh(ctx, signCanvas(p.name, { sub: p.label, bg: '#0f766e', fg: '#ffffff', w: 512, h: 160, radius: 10 }), 0.42, 0.13);
        lbl.position.set(-0.27, 1.32, z); lbl.rotation.y = -Math.PI / 2;
        shelf.add(lbl);
        const hb = Interaction.hitBox(0.48, 1.0, 0.44); hb.position.set(0, 0.6, z); shelf.add(hb);
        stacks.push({ p, hb });
      });
      shelf.position.copy(R);
      shelf.rotation.y = Math.PI / 2;
      root.add(shelf);
      player.addBoxCentered(R.x, R.z, 1.9, 0.5, 0, 'packshelf');
      footprints.push({ x: R.x, z: R.z, w: 1.9, d: 0.5, s: 0.35, blur: 0.2 });
      shelf.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      for (const st of stacks) {
        interaction.add({
          object: st.hb, kind: 'button', color: 0x2dd4bf, maxDist: 3,
          label: `${st.p.name} (${st.p.label})`,
          sub: () => packState.step === 'choose' ? 'Klicken: diese Verpackung nehmen' : 'Erst einen Auftrag auf den Packtisch holen',
          onPrimary: () => choosePackaging(st.p),
        });
      }
      // Ausgangs-Rollenbahn
      const out = rollerConveyor(ctx, [new THREE.Vector3(T.x, 0, T.z + along / 2 + 0.15), new THREE.Vector3(T.x, 0, HALL.d / 2 - 0.3)], { width: 0.62, height: 0.86 });
      player.addBox(T.x - 0.4, T.z + along / 2, T.x + 0.4, HALL.d / 2, 'outconv');
      footprints.push({ x: T.x, z: (T.z + along / 2 + HALL.d / 2) / 2, w: 0.8, d: HALL.d / 2 - T.z - along / 2, s: 0.3, blur: 0.2 });
      const outHit = Interaction.hitBox(0.7, 0.3, 1.2); outHit.position.set(T.x, 0.9, T.z + along / 2 + 0.7); root.add(outHit);
      interaction.add({
        object: outHit, kind: 'button', color: 0x2dd4bf, maxDist: 3, label: 'Versandband',
        sub: () => packState.step === 'ship' ? 'Klicken: Paket aufs Band legen' : (packState.step === 'label' ? 'Erst das Versandlabel drucken' : 'Hier gehen fertige Pakete raus'),
        onPrimary: () => ship(),
      });
      const printHit = Interaction.hitBox(0.4, 0.35, 0.45); printHit.position.set(0, 0.17, 0); printer.add(printHit);
      interaction.add({
        object: printHit, kind: 'button', color: 0x2dd4bf, label: 'Etikettendrucker',
        sub: () => packState.step === 'label' ? 'Klicken: Versandlabel drucken' : 'Druckt Versandetiketten',
        onPrimary: () => printLabel(),
      });
      // zweite Packstation (Deko)
      if (assets.templates.get('packing_station_full')) {
        const ps = assets.get('packing_station_full');
        const pinfo = assets.info('packing_station_full');
        ps.rotation.y = faceRotation(pinfo && pinfo.front, '-X', assets.size('packing_station_full'));
        ps.position.set(T.x + 0.2, 0, -4.6); root.add(ps);
        const s = assets.size('packing_station_full');
        player.addBoxCentered(T.x + 0.2, -4.6, Math.min(s.x, s.z), Math.max(s.x, s.z), 0, 'ps2');
        footprints.push({ x: T.x + 0.2, z: -4.6, w: Math.min(s.x, s.z), d: Math.max(s.x, s.z), s: 0.35, blur: 0.25 });
      }
      return { top, along, across, scrCanvas, scrTex, outRoller: out.rollerMap, out, takeOrder, printer };
    }

    function cartNearPack() { return cart.position.distanceTo(SPOTS.pack) < 3.4; }
    function takeOrder(t) {
      const o = orders[t.index];
      if (o.packed) { ui.toast(`Auftrag ${o.no} ist bereits verpackt.`, 'info'); return; }
      if (packState.order) { ui.toast(`Erst Auftrag ${packState.order.no} fertig verpacken.`, 'warn'); return; }
      if (!cartNearPack()) { ui.toast('Bring den Wagen näher an den Packtisch.', 'warn'); return; }
      packState.order = o; packState.tote = t; packState.step = 'choose';
      // Ware aus dem Behälter auf den Tisch
      const T = SPOTS.pack;
      t.items.forEach((it, i) => {
        cart.remove(it.mesh);
        const m = makeUnitMesh(it.sku);
        const holder = new THREE.Group(); holder.add(m);
        fitObject(m, Math.max(...it.sku.dims));   // Originalgröße auf dem Tisch
        holder.position.set(T.x - 0.18 + (i % 2) * 0.2, pack.top + 0.005, T.z - 0.35 + Math.floor(i / 2) * 0.24);
        m.position.y += new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3()).y / 2;
        root.add(holder);
        packState.items.push(holder);
      });
      t.items.length = 0;
      audio.play('put');
      refreshCart(); drawPackScreen(); updateObjective();
    }
    function choosePackaging(p) {
      if (packState.step !== 'choose') { ui.toast(packState.step === 'idle' ? 'Hol zuerst einen Auftrag vom Wagen (Behälter anklicken).' : 'Verpackung ist schon gewählt.', 'info'); return; }
      const o = packState.order;
      const dims = o.lines.flatMap(l => Array.from({ length: l.qty }, () => l.sku.dims));
      const best = bestPackaging(dims);
      const m = ctx.currentMission;
      if (!fits(dims, p)) {
        audio.play('error');
        o.tooSmall = (o.tooSmall || 0) + 1;
        state.packTooSmall++;
        ui.toast(`**${p.name} ist zu klein** – die Ware passt nicht hinein. Prüfe die Maße auf dem Bildschirm.`, 'error', 4200);
        drawPackScreen(`${p.name}: passt nicht!`);
        return;
      }
      o.choice = p; o.best = best; o.fill = fillRate(dims, p);
      if (p.id !== best.id) {
        state.packWasteful++;
        audio.play('warn');
        ui.toast(`Passt – aber **viel Luft** (Füllgrad ${Math.round(o.fill * 100)} %). Besser wäre: **${best.name}**.`, 'warn', 4500);
      } else {
        audio.play('ok');
        ui.toast(`Gute Wahl: **${p.name}** (Füllgrad ${Math.round(o.fill * 100)} %).`, 'ok', 2600);
      }
      // Ware verschwindet im Paket
      for (const h of packState.items) root.remove(h);
      packState.items = [];
      const T = SPOTS.pack;
      const box = makeParcel(p);
      box.position.set(T.x - 0.1, pack.top, T.z - 0.15);
      root.add(box);
      packState.box = box;
      packState.step = 'label';
      drawPackScreen(); updateObjective();
    }
    function printLabel() {
      if (packState.step !== 'label') { ui.toast(packState.step === 'ship' ? 'Label klebt schon – ab aufs Versandband!' : 'Es gibt gerade nichts zu etikettieren.', 'info'); return; }
      audio.play('printer', { position: pack.printer.getWorldPosition(new THREE.Vector3()) });
      const o = packState.order;
      const lbl = signMesh(ctx, shippingLabelCanvas(o), 0.15, 0.1);
      const bb = new THREE.Box3().setFromObject(packState.box);
      lbl.rotation.x = -Math.PI / 2;
      lbl.position.set(0, bb.max.y - packState.box.position.y + 0.002, 0);
      packState.box.add(lbl);
      packState.step = 'ship';
      drawPackScreen(); updateObjective();
    }
    const shipments = [];
    function ship() {
      if (packState.step !== 'ship') { ui.toast(packState.step === 'label' ? 'Erst das **Versandlabel** drucken (Etikettendrucker).' : 'Kein fertiges Paket auf dem Tisch.', 'info'); return; }
      const o = packState.order;
      const box = packState.box;
      const T = SPOTS.pack;
      box.position.set(T.x, pack.out.height + 0.02, T.z + pack.along / 2 + 0.35);
      shipments.push(box);
      o.packed = true;
      state.packedCount++;
      audio.play('whoosh');
      packState.order = null; packState.box = null; packState.step = 'idle';
      refreshCart(); drawPackScreen(); updateObjective();
      if (state.packedCount >= orders.length) setTimeout(() => finishMission(), 900);
      else ui.toast(`Paket ${o.no} ist unterwegs! Noch ${orders.length - state.packedCount} Aufträge.`, 'ok', 2200);
    }
    ctx.onUpdate(dt => {
      for (let i = shipments.length - 1; i >= 0; i--) {
        const b = shipments[i];
        b.position.z += dt * 0.6;
        if (b.position.z > HALL.d / 2 - 0.4) { root.remove(b); shipments.splice(i, 1); }
      }
    });

    // ---------- Anzeigen
    function drawKiosk() {
      const c = kioskCanvas, g = c.getContext('2d');
      g.fillStyle = '#0b1220'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#14b8a6'; g.fillRect(0, 0, c.width, 70);
      g.fillStyle = '#04201c'; g.font = `800 34px ${FONT}`; g.textBaseline = 'middle'; g.fillText('BATCH-TERMINAL', 24, 37);
      g.fillStyle = '#e2e8f0'; g.font = `700 36px ${FONT}`;
      if (phase === 'start') {
        wrapText(g, 'Wagen hierher bringen und Terminal antippen.', 24, 115, c.width - 48, 46);
        g.fillStyle = '#fbbf24'; g.font = `800 40px ${FONT}`; g.fillText(`Batch ${BATCH.no}`, 24, 290);
        g.fillStyle = '#94a3b8'; g.font = `600 30px ${FONT}`; g.fillText(`6 Aufträge · ${totalUnits} Teile`, 24, 340);
      } else {
        g.fillText(`Batch ${BATCH.no} aktiv`, 24, 120);
        g.fillStyle = '#34d399'; g.font = `800 64px ${FONT}`; g.fillText(`${state.put} / ${totalUnits}`, 24, 210);
        g.fillStyle = '#94a3b8'; g.font = `500 24px ${FONT}`; g.fillText('Teile im Wagen', 24, 262);
      }
      kioskTex.needsUpdate = true;
    }
    function drawCartScreen() {
      const c = ui.device.canvas, g = ui.device.ctx, W = c.width, H = c.height;
      g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#14b8a6'; g.fillRect(0, 0, W, 86);
      g.fillStyle = '#04201c'; g.font = `800 36px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText('PAKETWERK · Wagen 07', 24, 44);
      g.fillStyle = '#cbd5e1'; g.font = `600 26px ${FONT}`;
      const phaseText = { start: 'Wagen am Terminal anmelden', picking: `Batch ${BATCH.no} · Pick & Sort`, toPack: 'Batch fertig → Packstation', packing: 'Packen & Versand', done: 'Fertig!' }[phase];
      g.fillText(phaseText, 24, 124);
      let y = 176;
      for (const o of orders) {
        const tot = o.lines.reduce((s, l) => s + l.qty, 0), put = o.lines.reduce((s, l) => s + l.put, 0);
        const done = put >= tot;
        g.fillStyle = done ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.05)';
        roundRect(g, 18, y - 34, W - 36, 96, 14); g.fill();
        g.fillStyle = done ? '#34d399' : '#e2e8f0'; g.font = `800 38px ${FONT}`; g.fillText(String(o.idx + 1), 40, y);
        g.font = `700 24px ${FONT}`; g.fillStyle = '#e2e8f0'; g.fillText(`Auftrag ${o.no}`, 90, y - 6);
        g.font = `500 20px ${FONT}`; g.fillStyle = '#94a3b8'; g.fillText(o.customer, 90, y + 24);
        g.textAlign = 'right'; g.font = `800 30px ${MONO}`; g.fillStyle = o.packed ? '#2dd4bf' : done ? '#34d399' : '#fbbf24';
        g.fillText(o.packed ? 'VERSANDT' : `${put}/${tot}`, W - 40, y + 4); g.textAlign = 'left';
        y += 108;
      }
      g.fillStyle = '#94a3b8'; g.font = `500 22px ${FONT}`;
      const handTxt = hand.empty ? 'Hand: leer' : `Hand: ${hand.count} × ${hand.item.name}`;
      g.fillText(handTxt.length > 44 ? handTxt.slice(0, 43) + '…' : handTxt, 24, H - 40);
      ui.device.update();
    }
    function drawPackScreen(alert) {
      const c = pack.scrCanvas, g = c.getContext('2d'), W = c.width, H = c.height;
      g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#14b8a6'; g.fillRect(0, 0, W, 72);
      g.fillStyle = '#04201c'; g.font = `800 34px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText('PACKSTATION 1', 24, 37);
      g.textAlign = 'right'; g.fillText(`${state.packedCount}/6 versandt`, W - 24, 37); g.textAlign = 'left';
      const o = packState.order;
      if (!o) {
        g.fillStyle = '#e2e8f0'; g.font = `600 34px ${FONT}`;
        wrapText(g, phase === 'packing' ? 'Nächsten Behälter am Wagen anklicken – die Ware kommt auf den Tisch.' : 'Bring den Wagen mit dem fertigen Batch hierher.', 28, 140, W - 56, 46);
      } else {
        g.fillStyle = '#e2e8f0'; g.font = `700 32px ${FONT}`; g.fillText(`Auftrag ${o.no} · ${o.customer}`, 28, 112);
        g.font = `500 24px ${FONT}`; g.fillStyle = '#94a3b8'; g.fillText('Artikel', 28, 160); g.fillText('Maße (cm)', 560, 160); g.fillText('Volumen', 820, 160);
        let y = 200, tv = 0;
        for (const l of o.lines) {
          const d = l.sku.dims.map(v => Math.round(v * 100));
          const v = volume(l.sku.dims) * 1000 * l.qty; tv += v;
          g.fillStyle = '#e2e8f0'; g.font = `600 26px ${FONT}`;
          g.fillText(`${l.qty} × ${l.sku.name}`.slice(0, 34), 28, y);
          g.font = `500 26px ${MONO}`; g.fillText(`${d[0]}×${d[1]}×${d[2]}`, 560, y); g.fillText(`${fmtNum(v, 1)} l`, 820, y);
          y += 42;
        }
        g.fillStyle = '#2dd4bf'; g.font = `700 26px ${FONT}`; g.fillText(`Warenvolumen gesamt: ${fmtNum(tv, 1)} Liter`, 28, y + 10);
        const step = { choose: '① Passende Verpackung im Regal links wählen', label: '② Versandlabel am Etikettendrucker drucken', ship: '③ Paket aufs Versandband legen' }[packState.step];
        g.fillStyle = '#fbbf24'; g.font = `700 30px ${FONT}`; g.fillText(step || '', 28, H - 60);
        if (o.choice && packState.step !== 'choose') { g.textAlign = 'right'; g.fillStyle = o.choice.id === o.best.id ? '#34d399' : '#fbbf24'; g.font = `700 26px ${FONT}`; g.fillText(`${o.choice.name} · Füllgrad ${Math.round(o.fill * 100)} %`, W - 28, y + 10); g.textAlign = 'left'; }
      }
      if (alert) { g.fillStyle = 'rgba(248,113,113,0.95)'; roundRect(g, W - 420, 90, 392, 56, 12); g.fill(); g.fillStyle = '#fff'; g.font = `800 26px ${FONT}`; g.textAlign = 'center'; g.fillText(alert, W - 224, 119); g.textAlign = 'left'; }
      pack.scrTex.needsUpdate = true;
    }

    // ---------- Ziele / HUD
    function updateObjective() {
      let t;
      if (phase === 'start') t = towing ? 'Schieb den Wagen zum **Batch-Terminal** (links vor der Pickzone) und tippe es an.' : 'Nimm den **Multi-Order-Wagen** mit (Taste **F**) und melde ihn am **Batch-Terminal** an.';
      else if (phase === 'picking') {
        const open = lanes.filter(l => l.state === 'active').length;
        t = hand.empty ? `Folge den **Lichtern**: Display = Menge. **${open} ${open === 1 ? 'Fach leuchtet' : 'Fächer leuchten'}** noch. Ein Klick = ein Stück.` : 'Leg die Ware in den Behälter am Wagen, dessen **Licht leuchtet**.';
      } else if (phase === 'toPack') t = 'Batch komplett! Bring den Wagen zur **Packstation** (rechts, Schild „PACKEN“).';
      else if (phase === 'packing') {
        if (!packState.order) t = `Klick einen **Behälter am Wagen** an – die Ware kommt auf den Packtisch. (${state.packedCount}/6 versandt)`;
        else t = { choose: 'Wähle die **kleinste passende Verpackung** im Regal links (Maße stehen auf dem Bildschirm).', label: 'Druck das **Versandlabel** (Etikettendrucker rechts auf dem Tisch).', ship: 'Leg das Paket aufs **Versandband** (rechts).' }[packState.step];
      } else t = 'Alle Pakete sind versandt!';
      ui.setObjective(t);
    }
    ctx.onUpdate(dt => {
      updateCart(dt);
      // Fehler-Blinken abklingen lassen
      for (const l of lanes) if (l.flash > 0) { l.flash -= dt; if (l.flash <= 0) { l.flash = 0; refreshLane(l); } }
      for (const t of toteState) if (t.flash > 0) { t.flash -= dt; if (t.flash <= 0) { t.flash = 0; refreshCart(); } }
      // Quittier-Tasten blinken
      blinkT += dt;
      if (blinkT > 0.45) {
        blinkT = 0;
        for (const l of lanes) if (l.state === 'active' && l.remaining === 0 && hand.sku !== l.sku.id) { l.blink = !l.blink; refreshLane(l); }
      }
      // Phase Packen beginnt, sobald der Wagen an der Packstation steht
      if (phase === 'toPack' && cartNearPack()) { phase = 'packing'; state.packStart = ctx.currentMission ? ctx.currentMission.elapsed : 0; refreshCart(); drawPackScreen(); drawCartScreen(); updateObjective(); ui.toast('Packstation erreicht. Klick den **ersten Behälter** am Wagen an.', 'info', 3500); }
      const m = ctx.currentMission;
      if (m && m.running) {
        ui.setStats([
          { label: 'Zeit', value: fmtTime(m.elapsed) },
          { label: 'Teile', value: `${state.put}/${totalUnits}` },
          { label: 'Versandt', value: `${state.packedCount}/6` },
          { label: 'Fehler', value: String(m.errors.length), cls: m.errors.length ? 'err' : '' },
        ]);
      }
    });
    let blinkT = 0;
    const onHand = () => { if (phase === 'picking') { refreshCart(); for (const l of lanes) if (l.state === 'active') refreshLane(l); drawCartScreen(); updateObjective(); } };
    engine.addEventListener('handchange', onHand);
    const onDevice = () => { if (input.gameActive && !engine.isXR) ui.device.toggleBig(); };
    input.addEventListener('device', onDevice);

    function finishMission() {
      phase = 'done';
      const m = ctx.currentMission;
      const optimal = orders.filter(o => o.choice && o.best && o.choice.id === o.best.id).length;
      const avgFill = orders.reduce((s, o) => s + (o.fill || 0), 0) / orders.length;
      const airLiters = orders.reduce((s, o) => s + (o.choice ? (volume(o.choice.dims) - o.lines.reduce((a, l) => a + volume(l.sku.dims) * l.qty, 0)) * 1000 : 0), 0);
      const r = m.finish({ packOptimal: optimal, avgFill, orders: 6 });
      const prev = loadResults();
      const l1 = prev.lager1 && prev.lager1.last;
      const bars = [];
      if (l1) bars.push({ label: 'Lager 01 (Papier)', value: Math.round(l1.distance / 2), text: fmtNum(l1.distance / 2) + ' m' });
      bars.push({ label: 'Lager 03 (Batch)', value: Math.round(r.distance / 6), text: fmtNum(r.distance / 6) + ' m', me: true });
      const blocks = [
        { h: 'Kommissionierung mit Pick-by-Light' },
        { kpis: [
          { v: `${state.put}/${totalUnits}`, l: 'Teile kommissioniert' },
          { v: state.errors.wrong_bin, l: 'Griffe ins falsche Fach', color: state.errors.wrong_bin ? '#f87171' : '#34d399' },
          { v: state.errors.wrong_tote, l: 'Falsche Behälter', color: state.errors.wrong_tote ? '#f87171' : '#34d399' },
          { v: fmtTime(Math.max(0, state.pickEnd - state.batchStart)), l: 'Zeit für den Batch' },
        ] },
        { p: 'Jeder Fehlgriff wurde **sofort** angezeigt (rotes Licht) und konnte korrigiert werden – bei Pick-by-Paper wäre er erst beim Packen oder beim Kunden aufgefallen.' },
        { h: 'Verpackung' },
        { table: { head: ['Auftrag', 'Artikel', 'Gewählt', 'Optimal', 'Füllgrad'], rows: orders.map(o => [o.no, o.lines.map(l => `${l.qty}× ${l.sku.shortName}`).join(', '), o.choice ? o.choice.name : '–', o.best ? o.best.name : '–', { t: o.choice ? `${Math.round(o.fill * 100)} %` : '–', cls: o.choice && o.best && o.choice.id === o.best.id ? 'st-ok' : 'st-warn' }]) } },
        { kpis: [
          { v: `${optimal}/6`, l: 'Optimal verpackt', color: optimal === 6 ? '#34d399' : '#fbbf24', h: 'günstigste passende Verpackung' },
          { v: `${Math.round(avgFill * 100)} %`, l: 'Ø Füllgrad' },
          { v: `${fmtNum(airLiters, 1)} l`, l: 'Luft verschickt' },
          { v: state.packTooSmall, l: 'Fehlversuche (zu klein)', color: state.packTooSmall ? '#fbbf24' : '#34d399' },
        ] },
        { p: 'Die **günstigste passende Verpackung** ist optimal: Flache, unempfindliche Ware gehört in die **Versandtasche**, alles andere in den kleinsten Karton, in den es passt.' },
        { h: 'Laufweg je Auftrag' }, { bars },
      ];
      ctx.complete(r, {
        title: 'Batch versandt!',
        blocks,
        lesson: '**Multi-Order-Picking:** Du hast 6 Aufträge in **einem Rundgang** kommissioniert – der Laufweg pro Auftrag sinkt drastisch. **Pick-by-Light** zeigt Fach und Menge und meldet Fehlgriffe sofort. Und die **richtige Verpackung** spart Versandkosten, Füllmaterial und CO₂.',
      });
    }

    // ---------- Licht
    const fixtures = [];
    for (let x = -10; x <= 10.1; x += 3.33) for (let z = -7.5; z <= 7.6; z += 3) fixtures.push({ x, z, ry: 0 });
    setupLighting(ctx, {
      sky: 0xf1f6ff, ground: 0x8d939b, hemi: 0.55, key: 2.3, keyColor: 0xf6f9ff, keyDir: [0.3, 1, 0.42],
      fixtures, fixtureKind: 'panel', fixtureHeight: 6.3, ceilingY: HALL.h, lampColor: 0xf4f8ff, lampIntensity: 5,
      background: 0xd9e0e7, shadowExtent: 14,
    });
    bakeFloorAO(ctx, hall.floor, HALL.w, HALL.d, footprints, { edge: 0.7, edgeStrength: 0.3 });

    // ---------- Infopunkte
    const info = (x, y, z, card) => ctx.addInfoPoint(new THREE.Vector3(x, y, z), card);
    info(-2.25, 2.0, -1.55, {
      title: 'Das Durchlaufregal', subtitle: 'First in – first out (FIFO)',
      blocks: [
        { p: 'Die Behälter stehen auf **geneigten Rollenbahnen**. Befüllt wird von **hinten** (Nachschubgang), entnommen **vorne** (Pickgang). Ist der vordere Behälter leer, wird er entnommen – der nächste rollt automatisch nach.' },
        { list: ['**FIFO:** Was zuerst eingelagert wurde, wird zuerst entnommen – wichtig bei Mindesthaltbarkeit.', '**Trennung** von Nachschub und Kommissionierung: Niemand steht sich im Weg.', '**Kurze Wege:** Viele Artikel auf kleiner Pickfront.'] },
        { callout: 'Typisch für Schnelldreher im E-Commerce: Artikel mit vielen Zugriffen gehören in die Durchlaufregale an der Pickfront.', tone: 'teal' },
      ],
    });
    info(-4.4, 1.95, -0.85, {
      title: 'Pick-by-Light', subtitle: 'Licht zeigt Fach und Menge',
      blocks: [
        { p: 'An jedem Fach sitzt ein **Display mit Taste**. Das System lässt die Fächer leuchten, aus denen du greifen sollst, und zeigt die **Menge**. Mit der Taste **quittierst** du die Entnahme.' },
        { list: ['**+** sehr schnell, Hände frei, kaum Suchzeit', '**+** niedrige Fehlerquote, Bestände in Echtzeit', '**–** hohe Investition: ein Modul pro Fach', '**–** lohnt sich vor allem für Artikel mit vielen Zugriffen'] },
        { callout: 'Varianten: **Put-to-Light** (Licht zeigt, wohin abgelegt wird – wie an deinem Wagen), **Pick-by-Voice** (Sprachansage), **Pick-by-Scan** (Scanner).' },
      ],
    });
    info(SPOTS.terminal.x + 0.35, 2.0, SPOTS.terminal.z + 0.4, {
      title: 'Multi-Order-Picking', subtitle: 'Mehrere Aufträge in einem Rundgang',
      blocks: [
        { p: 'Online-Bestellungen sind oft **klein** (1–3 Artikel). Würde man jeden Auftrag einzeln holen, liefe man ständig dieselben Wege. Deshalb fasst das System Aufträge zu einem **Batch** zusammen.' },
        { p: 'Du holst alle Artikel des Batches in **einem Rundgang** – der Laufweg pro Auftrag sinkt stark, die Pickleistung steigt.' },
        { callout: 'Das Lagerverwaltungssystem (LVS/WMS) bildet die Batches so, dass sich die Wege möglichst gut überschneiden.', tone: 'teal' },
      ],
    });
    info(SPOTS.cart.x + 0.6, 1.85, SPOTS.cart.z + 1.0, {
      title: 'Einstufig oder zweistufig?', subtitle: 'Pick & Sort am Wagen',
      blocks: [
        { p: '**Einstufige Kommissionierung:** Die Ware kommt beim Picken direkt in den Auftragsbehälter. Bei dir passiert das **auftragsparallel** – du sortierst schon am Wagen in 6 Behälter (**Pick & Sort**).' },
        { p: '**Zweistufige Kommissionierung:** Erst werden alle Artikel eines Batches **artikelweise gesammelt** (Stufe 1), danach an einer **Put-Wall** oder einem Sorter auf die Aufträge **verteilt** (Stufe 2).' },
        { callout: 'Zweistufig lohnt sich bei sehr vielen kleinen Aufträgen mit gleichen Artikeln – dafür braucht es einen zusätzlichen Arbeitsschritt.' },
      ],
    });
    info(SPOTS.rackShelf.x - 1.3, 1.9, SPOTS.rackShelf.z + 0.1, {
      title: 'Verpackung & Nachhaltigkeit', subtitle: 'So klein wie möglich, so groß wie nötig',
      blocks: [
        { p: 'Der **Füllgrad** sagt, wie viel vom Paketvolumen tatsächlich mit Ware gefüllt ist. Viel Luft bedeutet:' },
        { list: ['**höhere Versandkosten** – Paketdienste rechnen auch nach Größe (Volumengewicht, Gurtmaß)', '**mehr Füllmaterial** und mehr Verpackungsmüll', '**mehr Transporte** und CO₂, weil weniger Pakete in einen LKW passen', 'Ware rutscht und wird eher beschädigt'] },
        { callout: '**Gurtmaß** = längste Seite + 2 × Breite + 2 × Höhe. Viele Paketdienste staffeln ihre Preise danach.', tone: 'teal' },
      ],
    });
    info(-10.0, 1.9, 3.0, {
      title: 'Retouren im E-Commerce', subtitle: 'Rücksendungen gehören zum Geschäft',
      blocks: [
        { p: 'Im Onlinehandel kommt ein großer Teil der Pakete zurück – besonders bei Mode. Jede **Retoure** muss geprüft werden:' },
        { list: ['**A-Ware:** wie neu → zurück ins Lager, wieder verkaufbar', '**B-Ware:** leichte Mängel / Verpackung beschädigt → reduziert verkaufen', '**defekt:** Reklamation beim Hersteller, Recycling oder Entsorgung'] },
        { callout: 'Gute Kommissionierung senkt Retouren: Wer den richtigen Artikel in der richtigen Menge schickt, bekommt weniger zurück.' },
      ],
    });

    // kleine Teile werfen keine Schatten (spart Draw-Calls im Schattenpass, v. a. auf der Quest)
    const _ws = new THREE.Vector3();
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || !o.castShadow) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.getWorldScale(_ws);
      if (o.geometry.boundingSphere.radius * Math.max(_ws.x, _ws.y, _ws.z) < 0.25) o.castShadow = false;
    });

    drawKiosk(); drawCartScreen(); refreshCart(); drawPackScreen();
    ui.device.show(true);
    ui.device.setCaption('Wagen-Display · <kbd>Tab</kbd> groß/klein');
    updateObjective();
    onProgress && onProgress(1, 'fertig');

    const mission = ctx.mission({ targetTime: 540, expectedLines: totalLines });
    return {
      spawn: SPOTS.spawn,
      hints: [['WASD', 'gehen'], ['Klick', 'nehmen / ablegen / quittieren'], ['Rechtsklick', 'zurücklegen'], ['F', 'Wagen mitnehmen'], ['Tab', 'Wagen-Display'], ['C', 'bücken'], ['P', 'Pause']],
      briefing: {
        title: 'Lager 03 · Fulfillment-Center „Paketwerk“',
        subtitle: 'Durchlaufregale · Pick-by-Light · Multi-Order-Picking · Verpacken',
        blocks: [
          { p: 'Im **Paketwerk** werden Online-Bestellungen für viele Shops abgewickelt („Fulfillment“). Damit niemand für jede kleine Bestellung einzeln durchs Lager läuft, holst du **6 Aufträge auf einmal** – Lichter zeigen dir, was zu tun ist.' },
          { h: 'So geht’s' },
          { list: [
            'Nimm den **Multi-Order-Wagen** mit (Taste **F**) und melde ihn am **Batch-Terminal** an (anklicken).',
            'In der Pickzone leuchten Fächer: Das **Display zeigt die Menge**. Ein Klick = ein Stück in die Hand.',
            'Am Wagen leuchtet der **Auftragsbehälter**, in den das Teil gehört (**Put-to-Light**). Anklicken = ablegen.',
            'Zeigt ein Fach **OK**, drückst du die **Taste am Fach** (anklicken) zum Quittieren.',
            'Zum Schluss an der **Packstation**: Behälter anklicken → **passende Verpackung** wählen → **Label** drucken → aufs **Versandband**.',
          ] },
          { callout: '**Tipp:** Nimm die kleinste Verpackung, in die alles passt. Luft im Paket kostet Versandgeld, Füllmaterial – und ist schlecht für die Umwelt.' },
          { p: 'Die türkisen **i-Punkte** erklären das Lager – beim Lesen läuft die Zeit nicht weiter.' },
        ],
      },
      start() {
        mission.start();
        audio.ambient('modern');
        audio.loop('motor', motor, { freq: 52, cutoff: 280, gain: 0.035, ref: 4 });
        updateObjective();
        ui.toast('Dein **Multi-Order-Wagen** steht vor dir. Taste **F** = mitnehmen.', 'info', 4500);
      },
      async afterBuild() {
        captureEnvironment(ctx, new THREE.Vector3(-1.5, 1.7, 0), { intensity: 0.85 });
      },
      pauseBlocks: () => [{ p: `Batch **${BATCH.no}** · ${state.put}/${totalUnits} Teile im Wagen · ${state.packedCount}/6 versandt` }],
      quiz: QUIZ,
      dispose() {
        input.removeEventListener('cart', onCartKey);
        input.removeEventListener('device', onDevice);
        engine.removeEventListener('handchange', onHand);
      },
    };

    // ---------- lokale Hilfsfunktionen mit Zugriff auf ctx
    function makeUnitMesh(sku) {
      if (sku.model && assets.templates.get(sku.model)) {
        const t = assets.get(sku.model);
        const g = new THREE.Group(); g.add(t);
        t.scale.setScalar(sku.modelScale || 1);
        return g;
      }
      const geo = unitBoxFrontUV(); ctx.track(geo);
      if (!sku._mat) {
        const t = packAtlas.texture.clone();
        t.repeat.set(sku.uv.w, sku.uv.h); t.offset.set(sku.uv.u, sku.uv.v); t.needsUpdate = true;
        ctx.track(t);
        sku._mat = ctx.track(new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
      }
      const mesh = new THREE.Mesh(geo, sku._mat);
      mesh.scale.set(...sku.dims);
      mesh.castShadow = true;
      const g = new THREE.Group(); g.add(mesh);
      return g;
    }
    let bagTex = null;
    function makeParcel(p) {
      const g = new THREE.Group();
      if (p.bag) {
        // Versandtasche: weiche, flache Folientasche mit Logo-Aufdruck
        if (!bagTex) {
          const c = makeCanvas(512, 368), g2 = c.getContext('2d');
          g2.fillStyle = '#e5e9ee'; g2.fillRect(0, 0, 512, 368);
          g2.fillStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < 40; i++) g2.fillRect(Math.random() * 512, 0, 2, 368);
          g2.fillStyle = '#0f766e'; roundRect(g2, 24, 24, 220, 64, 10); g2.fill();
          g2.fillStyle = '#ffffff'; g2.font = `900 40px ${FONT}`; g2.textBaseline = 'middle'; g2.fillText('PAKETWERK', 36, 58);
          g2.fillStyle = '#94a3b8'; g2.fillRect(0, 336, 512, 32);
          bagTex = ctx.track(new THREE.CanvasTexture(c)); bagTex.colorSpace = THREE.SRGBColorSpace;
        }
        const geo = new RoundedBoxGeometry(p.dims[0], 0.045, p.dims[1], 3, 0.02);
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bagTex, roughness: 0.42, metalness: 0 }));
        m.position.y = 0.0225; m.castShadow = true; g.add(m);
        ctx.track(geo); ctx.track(m.material);
      } else {
        const [w, d, h] = [p.dims[0] + 0.01, p.dims[1] + 0.01, p.dims[2] + 0.01];
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: cardboardTexture(), roughness: 0.85 }));
        m.position.y = h / 2; m.castShadow = true; m.receiveShadow = true; g.add(m);
        ctx.track(m.geometry); ctx.track(m.material);
      }
      return g;
    }
  },
};

// ------------------------------------------------------------------ Hilfsfunktionen
/** Drehung, damit die Vorderseite (manifest.front) in Zielrichtung zeigt */
function faceRotation(front, target, size) {
  const ang = { '+Z': 0, '+X': Math.PI / 2, '-Z': Math.PI, '-X': -Math.PI / 2 };
  const f = ang[front] ?? (size && size.x > size.z ? 0 : 0);
  return (ang[target] ?? 0) - f;
}

function productFront(s) {
  const [w, h] = s.dims;
  const aspect = w / h;
  const W = aspect >= 1 ? 320 : Math.max(96, Math.round(320 * aspect));
  const H = aspect >= 1 ? Math.max(96, Math.round(320 / aspect)) : 320;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, s.color); grd.addColorStop(1, shade(s.color, -0.3));
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(W * 0.9, H * 0.1, Math.max(W, H) * 0.45, 0, 7); g.fill();
  const m = Math.min(W, H);
  g.fillStyle = s.accent; g.fillRect(0, H - m * 0.16, W, m * 0.06);
  g.fillStyle = '#ffffff'; g.textBaseline = 'top'; g.textAlign = 'left';
  g.font = `900 ${Math.round(m * 0.13)}px ${FONT}`;
  g.fillText(s.brand.toUpperCase(), m * 0.07, m * 0.07, W - m * 0.14);
  g.font = `700 ${Math.round(m * 0.1)}px ${FONT}`;
  const y = wrapText(g, s.shortName, m * 0.07, m * 0.26, W - m * 0.14, m * 0.12);
  if (H > m * 1.4 || W > m * 1.4) drawIcon(g, s.icon, W - m * 0.25, Math.min(H - m * 0.35, y + m * 0.2), m * 0.13, '#ffffff');
  if (m > 120 && (W > 200 || H > 200)) { g.fillStyle = '#fff'; g.fillRect(m * 0.06, H - m * 0.42, m * 0.62, m * 0.22); drawEAN(g, s.ean, m * 0.07, H - m * 0.41, m * 0.6, m * 0.2); }
  return c;
}

function laneLabel(code, sku) {
  const c = makeCanvas(512, 176), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 176);
  g.fillStyle = '#0f766e'; g.fillRect(0, 0, 150, 176);
  g.fillStyle = '#fff'; g.font = `800 60px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(code.split('-')[1], 75, 92);
  g.font = `700 26px ${MONO}`; g.fillText('Zone ' + code[0], 75, 34);
  g.fillStyle = '#0f172a'; g.textAlign = 'left'; g.font = `700 34px ${FONT}`;
  wrapText(g, sku.shortName, 168, 46, 330, 38);
  g.fillStyle = '#475569'; g.font = `500 26px ${MONO}`; g.fillText(sku.art, 168, 144);
  return c;
}

function sectionalDoorCanvas() {
  const c = makeCanvas(512, 560), g = c.getContext('2d');
  g.fillStyle = '#c9d1d9'; g.fillRect(0, 0, 512, 560);
  for (let y = 0; y < 560; y += 80) {
    const gr = g.createLinearGradient(0, y, 0, y + 80); gr.addColorStop(0, '#e2e8f0'); gr.addColorStop(0.9, '#aeb8c2'); gr.addColorStop(1, '#7c8793');
    g.fillStyle = gr; g.fillRect(0, y, 512, 80);
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = 0; x < 512; x += 16) g.fillRect(x, y + 10, 2, 60);
  }
  g.fillStyle = '#0f172a'; g.fillRect(200, 200, 112, 60);
  g.fillStyle = '#a5f3fc'; g.fillRect(206, 206, 100, 48);
  return c;
}

function logoCanvas() {
  const c = makeCanvas(2048, 512), g = c.getContext('2d');
  g.fillStyle = '#0f766e'; roundRect(g, 0, 0, 2048, 512, 40); g.fill();
  g.fillStyle = '#14b8a6'; roundRect(g, 40, 40, 400, 432, 36); g.fill();
  // Paket-Logo
  g.strokeStyle = '#ffffff'; g.lineWidth = 26; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(240, 110); g.lineTo(380, 180); g.lineTo(380, 340); g.lineTo(240, 410); g.lineTo(100, 340); g.lineTo(100, 180); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(100, 180); g.lineTo(240, 250); g.lineTo(380, 180); g.moveTo(240, 250); g.lineTo(240, 410); g.stroke();
  g.fillStyle = '#ffffff'; g.font = `900 200px ${FONT}`; g.textBaseline = 'middle';
  g.fillText('PAKETWERK', 500, 220);
  g.font = `500 72px ${FONT}`; g.fillStyle = '#ccfbf1';
  g.fillText('Fulfillment für Online-Händler · heute bestellt, morgen da', 506, 380, 1500);
  return c;
}

function drawDashboard(c, shipped) {
  const g = c.getContext('2d'), W = c.width, H = c.height;
  g.fillStyle = '#05080f'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#14b8a6'; g.font = `800 44px ${FONT}`; g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillText('PAKETWERK · LIVE', 40, 30);
  g.fillStyle = '#94a3b8'; g.font = `500 30px ${MONO}`; g.textAlign = 'right';
  g.fillText(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), W - 40, 38);
  g.textAlign = 'left';
  const tile = (x, y, v, l, col) => { g.fillStyle = 'rgba(255,255,255,0.05)'; roundRect(g, x, y, 450, 170, 18); g.fill(); g.fillStyle = col; g.font = `800 72px ${FONT}`; g.fillText(v, x + 24, y + 22); g.fillStyle = '#94a3b8'; g.font = `500 28px ${FONT}`; g.fillText(l, x + 26, y + 116); };
  tile(40, 110, shipped.toLocaleString('de-DE'), 'Pakete heute versendet', '#e2e8f0');
  tile(534, 110, '2.910', 'Teile/Stunde (Team Pick)', '#34d399');
  tile(40, 310, '0,08 %', 'Fehlerquote heute', '#2dd4bf');
  tile(534, 310, '18:00', 'Cut-off: morgen beim Kunden', '#fbbf24');
}

function shippingLabelCanvas(o) {
  const c = makeCanvas(600, 400), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 600, 400);
  g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(6, 6, 588, 388);
  g.fillStyle = '#111'; g.font = `900 40px ${FONT}`; g.textBaseline = 'top'; g.fillText('PAKET', 24, 20);
  g.font = `600 28px ${FONT}`; g.fillText(o.customer, 24, 80, 552);
  g.font = `500 24px ${MONO}`; g.fillText(`Auftrag ${o.no}`, 24, 124);
  // 2D-Code-Optik
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if ((x * 7 + y * 13 + x * y) % 3 === 0) g.fillRect(420 + x * 12, 170 + y * 12, 12, 12);
  for (let i = 0; i < 46; i++) { const w = 2 + ((i * 7) % 4) * 2; g.fillRect(24 + i * 8, 190, w, 120); }
  g.font = `600 22px ${MONO}`; g.fillText('00340434 1612 0007 ' + o.no, 24, 330);
  return c;
}

const QUIZ = [
  { q: 'Was bedeutet Multi-Order-Picking?', options: ['Mehrere Aufträge werden gleichzeitig in einem Rundgang kommissioniert', 'Ein Auftrag wird von mehreren Pickern gleichzeitig bearbeitet', 'Jeder Artikel wird mehrfach gescannt', 'Aufträge werden streng nach Bestelleingang einzeln abgearbeitet'], correct: 0, explain: 'Beim Multi-Order-Picking fasst das System mehrere (oft kleine) Aufträge zu einem Batch zusammen. So sinkt der Laufweg pro Auftrag deutlich.' },
  { q: 'Wie funktioniert ein Durchlaufregal?', options: ['Die Ware rollt auf geneigten Bahnen nach vorne – befüllt wird hinten, entnommen vorne (FIFO)', 'Die Ware wird oben eingelegt und unten entnommen (LIFO)', 'Ein Roboter bringt das ganze Regal zum Picker', 'Das Regal dreht sich auf Knopfdruck zum Picker'], correct: 0, explain: 'Nachschub kommt von hinten, gepickt wird vorne. Was zuerst eingelagert wurde, wird zuerst entnommen – First in, first out.' },
  { q: 'Was zeigt das Display an einem Pick-by-Light-Fach an?', options: ['Ob hier entnommen werden soll und wie viele Stück', 'Den aktuellen Lagerbestand des Fachs', 'Den Verkaufspreis des Artikels', 'Die Lieferadresse des Kunden'], correct: 0, explain: 'Das Licht zeigt das richtige Fach, die Zahl die Entnahmemenge. Mit der Taste quittiert der Picker die Entnahme.' },
  { q: 'Warum ist ein hoher Füllgrad beim Verpacken wichtig?', options: ['Weniger Luft spart Versandkosten, Füllmaterial und CO₂', 'Volle Pakete sind schwerer und deshalb günstiger', 'Der Füllgrad bestimmt die Lieferzeit', 'Pakete mit hohem Füllgrad sind zollfrei'], correct: 0, explain: 'Paketdienste rechnen auch nach Größe (Gurtmaß, Volumengewicht). Kleine, gut gefüllte Pakete sparen Geld, Material und Transportplatz.' },
  { q: 'Welche Aussage zu Pick-by-Light stimmt?', options: ['Es ist schnell und fehlerarm, lohnt sich aber vor allem für Artikel mit vielen Zugriffen', 'Es braucht keinerlei Technik und ist deshalb sehr billig', 'Es funktioniert nur zusammen mit einer Papierliste', 'Es macht jede Kontrolle beim Verpacken überflüssig'], correct: 0, explain: 'Jedes Fach braucht ein eigenes Modul – das kostet. Deshalb setzt man Pick-by-Light besonders bei Schnelldrehern mit vielen Picks ein.' },
  { q: 'Du legst jedes Teil sofort in den Behälter des richtigen Auftrags am Wagen. Wie nennt man das?', options: ['Einstufige, auftragsparallele Kommissionierung (Pick & Sort)', 'Zweistufige Kommissionierung – erst sammeln, dann verteilen', 'Cross-Docking', 'Inventur'], correct: 0, explain: 'Du sortierst schon beim Picken (Sort-while-Pick). Zweistufig wäre es, wenn erst alle Artikel gesammelt und danach an einer Put-Wall auf die Aufträge verteilt würden.' },
];
