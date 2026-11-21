// Lager 4 – Bauteile: Zaun ums Roboterfeld, Bodenmarken, Pick-Station mit Lichtvorhang & Lichtzeiger,
// Putwall mit Fächern, Förderband, Ladestationen.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxGeo, mergeToMesh } from '../../core/env.js';
import { Interaction } from '../../core/interaction.js';
import { makeCanvas, FONT, MONO, signCanvas } from '../../core/canvas.js';
import { roundRect } from '../../core/interaction.js';
import { GRID, cxw, czw, cellType } from './fleet.js';

const H = new THREE.Color();

/** Gitterzaun mit Pfosten. segments: [{x1,z1,x2,z2}] ; Öffnungen sind bereits ausgespart */
export function buildFence(ctx, segments, { height = 2.05 } = {}) {
  const { mat, player, root } = ctx;
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = '#e8ecf0'; g.lineWidth = 3.2;
  for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  const meshTex = ctx.track(new THREE.CanvasTexture(c));
  meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
  meshTex.colorSpace = THREE.SRGBColorSpace;
  meshTex.anisotropy = 8;
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, map: meshTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
  ctx.track(panelMat);
  const postGeos = [], railGeos = [], panelGeos = [], capGeos = [];
  for (const s of segments) {
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1, len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 2.0));
    const ang = Math.atan2(dz, dx);
    for (let k = 0; k <= n; k++) {
      const x = s.x1 + dx * k / n, z = s.z1 + dz * k / n;
      postGeos.push(boxGeo(0.06, height + 0.05, 0.06, x, (height + 0.05) / 2, z));
      capGeos.push(boxGeo(0.07, 0.04, 0.07, x, height + 0.07, z));
    }
    const p = new THREE.PlaneGeometry(len, height - 0.25);
    const uv = p.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 3.2, uv.getY(i) * (height - 0.25) * 3.2);
    p.rotateY(-ang); p.translate((s.x1 + s.x2) / 2, 0.15 + (height - 0.25) / 2, (s.z1 + s.z2) / 2);
    panelGeos.push(p);
    for (const y of [0.15, height - 0.1, height]) {
      const r = new THREE.BoxGeometry(len, 0.03, 0.03); r.rotateY(-ang); r.translate((s.x1 + s.x2) / 2, y, (s.z1 + s.z2) / 2);
      railGeos.push(r);
    }
    // Kollision
    const minX = Math.min(s.x1, s.x2) - 0.06, maxX = Math.max(s.x1, s.x2) + 0.06, minZ = Math.min(s.z1, s.z2) - 0.06, maxZ = Math.max(s.z1, s.z2) + 0.06;
    player.addBox(minX, minZ, maxX, maxZ, 'fence');
  }
  const posts = mergeToMesh(postGeos, mat.basic(0xf2b705, 0.45, 0.3), { name: 'fence-posts' });
  const rails = mergeToMesh(railGeos, mat.basic(0x2a2f36, 0.45, 0.7), { name: 'fence-rails' });
  const panels = new THREE.Mesh(mergeGeometries(panelGeos), panelMat);
  panelGeos.forEach(p => p.dispose());
  panels.castShadow = false; panels.receiveShadow = false;
  // Leuchtband auf den Pfosten (Cyan)
  const caps = mergeToMesh(capGeos, mat.emissive(0x22d3ee, 2.5), { cast: false, name: 'fence-leds' });
  root.add(posts, rails, panels, caps);
  return { posts, rails, panels, caps };
}

/** QR-Bodenmarken auf jeder Rasterzelle (instanziert, 16 Varianten) + gelb-schwarze Feldmarkierung */
export function buildFieldFloor(ctx, fiducialCanvas, field) {
  const { root, mat } = ctx;
  // glänzender Epoxid-Boden im Roboterfeld (dunkel, spiegelnd)
  const ep = new THREE.Mesh(new THREE.PlaneGeometry(field.maxX - field.minX + 0.3, field.maxZ - field.minZ + 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1a212b, roughness: 0.22, metalness: 0.15, roughnessMap: mat.grungeTexture(3, 256, 0.5), polygonOffset: true, polygonOffsetFactor: -1 }));
  ep.material.roughnessMap = ep.material.roughnessMap.clone(); ep.material.roughnessMap.repeat.set(6, 4); ep.material.roughnessMap.wrapS = ep.material.roughnessMap.wrapT = THREE.RepeatWrapping; ep.material.roughnessMap.needsUpdate = true;
  ctx.track(ep.material); ctx.track(ep.material.roughnessMap);
  ep.rotation.x = -Math.PI / 2;
  ep.position.set((field.minX + field.maxX) / 2, 0.001, (field.minZ + field.maxZ) / 2);
  ep.receiveShadow = true;
  root.add(ep);
  const tex = ctx.track(new THREE.CanvasTexture(fiducialCanvas));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const geo = new THREE.PlaneGeometry(0.11, 0.11); geo.rotateX(-Math.PI / 2);
  const cells = [];
  for (let i = 0; i < GRID.NX; i++) for (let j = 0; j < GRID.NZ; j++) if (cellType(i, j) !== 'wall') cells.push([i, j]);
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 instOff;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = uv * 0.25 + instOff;\n#endif');
  };
  m.customProgramCacheKey = () => 'fiducial';
  const off = new Float32Array(cells.length * 2);
  const im = new THREE.InstancedMesh(geo, m, cells.length);
  const mm = new THREE.Matrix4();
  cells.forEach(([i, j], n) => {
    mm.makeRotationY(((i * 7 + j * 3) % 4) * Math.PI / 2).setPosition(cxw(i), 0.004, czw(j));
    im.setMatrixAt(n, mm);
    const v = (i * 5 + j * 11) % 16;
    off[n * 2] = (v % 4) * 0.25; off[n * 2 + 1] = 0.75 - Math.floor(v / 4) * 0.25;
  });
  geo.setAttribute('instOff', new THREE.InstancedBufferAttribute(off, 2));
  im.receiveShadow = true;
  ctx.track(geo); ctx.track(m);
  root.add(im);
  // Feldrand: gelb-schwarzer Streifen
  const hz = new THREE.MeshStandardMaterial({ map: mat.hazardTexture().clone(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  hz.map.wrapS = hz.map.wrapT = THREE.RepeatWrapping; hz.map.needsUpdate = true;
  ctx.track(hz); ctx.track(hz.map);
  const w = 0.14, y = 0.003;
  const strips = [];
  const strip = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const p = new THREE.PlaneGeometry(len, w); p.rotateX(-Math.PI / 2);
    const uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / w / 4, uv.getY(i));
    p.rotateY(-Math.atan2(z2 - z1, x2 - x1)); p.translate((x1 + x2) / 2, y, (z1 + z2) / 2);
    strips.push(p);
  };
  const { minX, maxX, minZ, maxZ } = field;
  strip(minX, minZ, maxX, minZ); strip(minX, maxZ, maxX, maxZ); strip(minX, minZ, minX, maxZ); strip(maxX, minZ, maxX, maxZ);
  const sm = new THREE.Mesh(mergeGeometries(strips), hz); strips.forEach(s => s.dispose());
  sm.receiveShadow = true;
  root.add(sm);
  return im;
}

/** Ladestation (Fallback ohne Modell): Säule mit Kontaktplatte und LED, Front +X */
export function chargerMesh(ctx) {
  const { mat } = ctx;
  const g = new THREE.Group();
  g.add(mergeToMesh([boxGeo(0.22, 0.75, 0.42, -0.08, 0.375, 0), boxGeo(0.3, 0.04, 0.5, -0.05, 0.02, 0)], mat.basic(0x30353d, 0.45, 0.5)));
  g.add(mergeToMesh([boxGeo(0.03, 0.08, 0.26, 0.04, 0.13, 0)], mat.basic(0xb08d57, 0.3, 1)));
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.1), mat.emissive(0x3b82f6, 3));
  led.position.set(0.035, 0.55, 0);
  g.add(led);
  g.userData.led = led;
  return g;
}

/**
 * Pick-Station am Feldrand. Öffnung bei x = ox (Zaunlinie), z ∈ [-ow/2, ow/2]; Spieler steht bei +X.
 * gibt Bauteile & Steuer-Handles zurück
 */
export function buildStationFrame(ctx, { ox, oz = 0, ow = 1.24, title = 'STATION 3', closed = false }) {
  const { mat, root, player } = ctx;
  const g = new THREE.Group(); g.name = 'station-' + title;
  const frameMat = mat.basic(0x2b3038, 0.4, 0.7);
  const postH = 2.75;
  const parts = [
    boxGeo(0.12, postH, 0.12, ox, postH / 2, oz - ow / 2 - 0.06), boxGeo(0.12, postH, 0.12, ox, postH / 2, oz + ow / 2 + 0.06),
    boxGeo(0.16, 0.16, ow + 0.4, ox, postH, oz),
  ];
  g.add(mergeToMesh(parts, frameMat));
  player.addBox(ox - 0.08, oz - ow / 2 - 0.13, ox + 0.08, oz - ow / 2, 'station-post');
  player.addBox(ox - 0.08, oz + ow / 2, ox + 0.08, oz + ow / 2 + 0.13, 'station-post');
  // LED-Balken unter dem Querträger
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, ow), mat.emissive(0xeaf6ff, closed ? 0.3 : 4));
  bar.position.set(ox + 0.04, postH - 0.1, oz);
  g.add(bar);
  // Schild
  const sc = signCanvas(title, { sub: closed ? 'nicht besetzt' : 'Ware-zur-Person · Pick', bg: closed ? '#1f2937' : '#0f172a', fg: closed ? '#6b7280' : '#e2e8f0', w: 768, h: 192 });
  const tex = ctx.track(new THREE.CanvasTexture(sc)); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.325), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: closed ? 0.25 : 0.9, roughness: 0.5 }));
  sign.position.set(ox + 0.09, postH + 0.3, oz); sign.rotation.y = Math.PI / 2;
  g.add(sign);
  // Ampel (Säulenleuchte) auf dem linken Pfosten
  const stack = new THREE.Group();
  const colors = [0xff2a1a, 0xffb000, 0x22e06b];
  const lamps = colors.map((c, i) => {
    const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0.15, roughness: 0.3 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 20), m);
    mesh.position.y = 0.06 + (2 - i) * 0.085;
    stack.add(mesh);
    return m;
  });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20), frameMat); cap.position.y = 0.32; stack.add(cap);
  stack.position.set(ox, postH + 0.08, oz + ow / 2 + 0.06);
  g.add(stack);
  // Lichtvorhang: Sender-/Empfängerleisten + schwache Strahlen
  // Lichtvorhang: schwarze Sender-/Empfängerleisten mit feiner roter LED-Reihe
  const housing = mat.basic(0x15181c, 0.4, 0.5);
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff2a2a, emissiveIntensity: closed ? 0.1 : 0.45 });
  for (const sz of [-1, 1]) {
    const hsg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.05, 0.04), housing);
    hsg.position.set(ox, 1.2, oz + sz * (ow / 2 + 0.005));
    g.add(hsg);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.95, 0.006), stripMat);
    s.position.set(ox, 1.2, oz + sz * (ow / 2 - 0.018));
    g.add(s);
  }
  const bc = makeCanvas(64, 256), bg = bc.getContext('2d');
  bg.clearRect(0, 0, 64, 256);
  for (let y = 8; y < 256; y += 32) { bg.fillStyle = 'rgba(255,70,70,0.8)'; bg.fillRect(0, y, 64, 1.5); }
  const btex = ctx.track(new THREE.CanvasTexture(bc));
  const beamMat = new THREE.MeshBasicMaterial({ map: btex, transparent: true, opacity: closed ? 0 : 0.03, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beams = new THREE.Mesh(new THREE.PlaneGeometry(ow - 0.02, 2.0), beamMat);
  beams.position.set(ox, 1.2, oz); beams.rotation.y = Math.PI / 2;
  beams.userData.noEnvCapture = true;
  g.add(beams);
  g.traverse(o => { if (o.isMesh && o !== beams) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(g);
  return {
    group: g, lamps, beamMat, stripMat,
    setLight(state) {   // 'run' | 'wait' | 'stop' | 'off'
      lamps[0].emissiveIntensity = state === 'stop' ? 6 : 0.15;
      lamps[1].emissiveIntensity = state === 'wait' ? 5 : 0.15;
      lamps[2].emissiveIntensity = state === 'run' ? 5 : 0.15;
    },
  };
}

/** Lichtzeiger: Projektor + Lichtkegel (additiv) + Spotlicht + leuchtender Rahmen um das Zielfach */
export function buildLightPointer(ctx, from) {
  const { root, mat } = ctx;
  const proj = new THREE.Mesh(mergeGeometries([boxGeo(0.16, 0.1, 0.16, 0, 0, 0), new THREE.CylinderGeometry(0.035, 0.035, 0.06, 16).rotateZ(Math.PI / 2).translate(-0.1, -0.02, 0)]), mat.basic(0x1f2329, 0.4, 0.6));
  proj.position.copy(from);
  root.add(proj);
  const c = makeCanvas(8, 128), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  // oben im Canvas = Zielende des Kegels (hell), unten = Projektor (ausgeblendet)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 128);
  const tex = ctx.track(new THREE.CanvasTexture(c));
  const beamGeo = new THREE.CylinderGeometry(0.11, 0.012, 1, 20, 1, true); // oben breit (Ziel), unten schmal (Projektor) → wird ausgerichtet
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x5eead4, map: tex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.userData.noEnvCapture = true;
  beam.renderOrder = 4;
  root.add(beam);
  const spot = new THREE.SpotLight(0x9ff5df, 0, 6, 0.15, 0.55, 1.6);
  spot.position.copy(from);
  root.add(spot, spot.target);
  // Rahmen
  const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.4, 1.2), toneMapped: true });
  const frame = new THREE.Group();
  const W = 0.31, Hh = 0.36, t = 0.016;
  for (const [w, h, x, y] of [[W, t, 0, Hh / 2], [W, t, 0, -Hh / 2], [t, Hh, W / 2, 0], [t, Hh, -W / 2, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.01, h, w), fm); b.position.set(0, y, x); frame.add(b);
  }
  frame.userData.noEnvCapture = true;
  root.add(frame);
  const up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  const api = {
    beam, spot, frame, proj,
    visible: false,
    pointAt(p, color = 0x5eead4) {
      const len = from.distanceTo(p);
      beam.scale.set(1, len, 1);
      beam.position.copy(from).add(p).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(up, tmp.copy(p).sub(from).normalize());
      beamMat.color.set(color);
      spot.target.position.copy(p);
      spot.intensity = 26;
      spot.color.set(color);
      frame.position.copy(p);
      fm.color.set(color).multiplyScalar(2.2);
      beam.visible = frame.visible = true;
      api.visible = true;
    },
    hide() { beam.visible = frame.visible = false; spot.intensity = 0; api.visible = false; },
    pulse(t) { if (api.visible) { beamMat.opacity = 0.24 + Math.sin(t * 6) * 0.08; frame.scale.setScalar(1 + Math.sin(t * 6) * 0.025); } },
  };
  api.hide();
  return api;
}

/**
 * Putwall: cols × rows Fächer, Front zeigt nach +Z, Mitte bei (x, z). Jedes Fach: Behälter, LED-Leiste, Taster, Nummer.
 */
export function buildPutWall(ctx, { x, z, cols = 4, rows = 2, slotW = 0.44, slotH = 0.4, depth = 0.5, y0 = 0.78, orders }) {
  const { mat, root, player } = ctx;
  const g = new THREE.Group(); g.name = 'putwall';
  const W = cols * slotW, Hh = rows * slotH;
  const frameMat = mat.basic(0x5b6573, 0.35, 0.7);
  const parts = [];
  for (let c = 0; c <= cols; c++) parts.push(boxGeo(0.025, Hh + 0.05, depth, -W / 2 + c * slotW, y0 + Hh / 2, -depth / 2));
  // helle Rückwand-Leisten, damit die Fächer lesbar sind
  for (let r = 0; r < rows; r++) parts.push(boxGeo(W, 0.04, 0.02, 0, y0 + r * slotH + 0.03, -depth + 0.02));
  for (let r = 0; r <= rows; r++) parts.push(boxGeo(W + 0.025, 0.025, depth, 0, y0 + r * slotH, -depth / 2));
  // Beine
  for (const sx of [-1, 1]) for (const sz of [0, -1]) parts.push(boxGeo(0.05, y0, 0.05, sx * (W / 2 - 0.02), y0 / 2, sz * (depth - 0.05) - 0.025));
  // Schrägblende oben mit Schild
  parts.push(boxGeo(W + 0.05, 0.16, 0.03, 0, y0 + Hh + 0.12, -0.02));
  g.add(mergeToMesh(parts, frameMat));
  // Behälter (offene Kiste)
  const toteGeo = mergeGeometries([
    boxGeo(slotW - 0.08, 0.012, depth - 0.08, 0, 0.006, 0),
    boxGeo(slotW - 0.08, 0.17, 0.012, 0, 0.085, (depth - 0.08) / 2), boxGeo(slotW - 0.08, 0.17, 0.012, 0, 0.085, -(depth - 0.08) / 2),
    boxGeo(0.012, 0.17, depth - 0.08, (slotW - 0.08) / 2, 0.085, 0), boxGeo(0.012, 0.17, depth - 0.08, -(slotW - 0.08) / 2, 0.085, 0),
  ].map(p => p.toNonIndexed()));
  ctx.track(toteGeo);
  // Etiketten (eine Textur, ein Mesh)
  const lc = makeCanvas(2048, 256), lg = lc.getContext('2d');
  const n = cols * rows;
  for (let k = 0; k < n; k++) {
    const cx = k * 256;
    lg.fillStyle = '#f8fafc'; lg.fillRect(cx + 4, 4, 248, 248);
    lg.fillStyle = '#0f172a'; lg.font = `900 120px ${FONT}`; lg.textAlign = 'center'; lg.textBaseline = 'middle';
    lg.fillText(String(k + 1), cx + 128, 100);
    lg.font = `600 30px ${MONO}`; lg.fillStyle = '#475569';
    lg.fillText(orders[k] ? orders[k].no : '', cx + 128, 200);
  }
  const ltex = ctx.track(new THREE.CanvasTexture(lc)); ltex.colorSpace = THREE.SRGBColorSpace; ltex.anisotropy = 8;
  const lgeos = [];
  const slots = [];
  for (let k = 0; k < n; k++) {
    const c = k % cols, r = rows - 1 - Math.floor(k / cols);   // Fach 1 oben links
    const sx = -W / 2 + (c + 0.5) * slotW, sy = y0 + r * slotH;
    const p = new THREE.PlaneGeometry(0.1, 0.1);
    const uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (k + uv.getX(i)) / n, uv.getY(i));
    p.translate(sx - slotW / 2 + 0.075, sy + slotH - 0.075, 0.003);
    lgeos.push(p);
    const toteMat = new THREE.MeshStandardMaterial({ color: [0x2f6fdc, 0x0ea5a0, 0xe08a1e, 0x7c4dde][k % 4], roughness: 0.5 });
    ctx.track(toteMat);
    const tote = new THREE.Mesh(toteGeo, toteMat);
    tote.position.set(sx, sy + 0.015, -depth / 2);
    tote.castShadow = true; tote.receiveShadow = true;
    g.add(tote);
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x22e06b, emissiveIntensity: 0.0 });
    ctx.track(ledMat);
    const led = new THREE.Mesh(new THREE.BoxGeometry(slotW - 0.16, 0.022, 0.02), ledMat);
    led.position.set(sx + 0.04, sy + slotH - 0.03, 0.012);
    g.add(led);
    const btnMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x38bdf8, emissiveIntensity: 0.0, roughness: 0.3 });
    ctx.track(btnMat);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.025, 20).rotateX(Math.PI / 2), btnMat);
    btn.position.set(sx + slotW / 2 - 0.06, sy + 0.05, 0.014);
    g.add(btn);
    const hit = Interaction.hitBox(slotW - 0.03, slotH - 0.03, depth);
    hit.position.set(sx, sy + slotH / 2, -depth / 2);
    g.add(hit);
    slots.push({ k, c, r, center: new THREE.Vector3(sx, sy, -depth / 2), tote, toteMat, ledMat, btnMat, hit, contents: [] });
  }
  const labels = new THREE.Mesh(mergeGeometries(lgeos), new THREE.MeshStandardMaterial({ map: ltex, roughness: 0.5, emissive: 0xffffff, emissiveMap: ltex, emissiveIntensity: 0.12 }));
  lgeos.forEach(p => p.dispose());
  g.add(labels);
  const sign = makeCanvas(1024, 96), sg = sign.getContext('2d');
  sg.fillStyle = '#0f172a'; sg.fillRect(0, 0, 1024, 96);
  sg.fillStyle = '#e2e8f0'; sg.font = `800 52px ${FONT}`; sg.textAlign = 'center'; sg.textBaseline = 'middle';
  sg.fillText('PUTWALL  ·  Fach 1 – 8 = Kundenauftrag', 512, 50);
  const stex = ctx.track(new THREE.CanvasTexture(sign)); stex.colorSpace = THREE.SRGBColorSpace;
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, W * 96 / 1024), new THREE.MeshStandardMaterial({ map: stex, emissive: 0xffffff, emissiveMap: stex, emissiveIntensity: 0.5 }));
  signMesh.position.set(0, y0 + Hh + 0.12, 0.0);
  g.add(signMesh);
  g.position.set(x, 0, z);
  g.traverse(o => { if (o.isMesh && o.material !== ctx.mat.emissive) { o.receiveShadow = true; } });
  root.add(g);
  player.addBox(x - W / 2 - 0.03, z - depth - 0.05, x + W / 2 + 0.03, z + 0.02, 'putwall');
  for (const s of slots) { s.world = s.center.clone().add(new THREE.Vector3(x, slotH / 2, z)); }
  const api = {
    group: g, slots,
    setState(k, state) {
      const s = slots[k]; s.state = state;
      const on = { idle: 0, target: 3.5, done: 1.6, error: 4, wait: 0 }[state] ?? 0;
      s.ledMat.emissive.set(state === 'done' ? 0x3b82f6 : state === 'error' ? 0xff3030 : 0x22e06b);
      s.ledMat.emissiveIntensity = on;
      s.btnMat.emissiveIntensity = state === 'target' ? 2.5 : 0;
    },
    tick(t, dt = 1 / 60) {
      for (const s of slots) {
        if (s.state === 'target') { const b = 0.5 + 0.5 * Math.sin(t * 8); s.ledMat.emissiveIntensity = 1 + b * 3.5; s.btnMat.emissiveIntensity = 1 + b * 2; }
        if (s.state === 'error' && s.errT !== undefined) { s.errT -= dt; if (s.errT <= 0) { s.errT = undefined; api.setState(s.k, s.prevState || 'idle'); } }
        if (s.confirmT > 0) { s.confirmT -= dt; s.btnMat.emissive.set(0x38bdf8); s.btnMat.emissiveIntensity = s.confirmT > 0 ? 4 : 0; }
      }
    },
    flashError(k) { const s = slots[k]; s.prevState = s.state === 'error' ? s.prevState : s.state; api.setState(k, 'error'); s.errT = 0.6; },
  };
  return api;
}

/** Rollenförderer (Fallback ohne Modell), entlang +X, Oberkante bei y */
export function rollerConveyor(ctx, { x1, x2, z, y = 0.76, w = 0.62 }) {
  const { mat, root } = ctx;
  const len = x2 - x1;
  const g = new THREE.Group();
  const frame = mat.basic(0x1e40af, 0.4, 0.5);
  const parts = [boxGeo(len, 0.1, 0.04, (x1 + x2) / 2, y - 0.04, z - w / 2), boxGeo(len, 0.1, 0.04, (x1 + x2) / 2, y - 0.04, z + w / 2)];
  for (let x = x1 + 0.3; x < x2; x += 1.2) for (const sz of [-1, 1]) parts.push(boxGeo(0.05, y - 0.08, 0.05, x, (y - 0.08) / 2, z + sz * (w / 2 - 0.02)));
  g.add(mergeToMesh(parts, frame));
  const n = Math.floor(len / 0.1);
  const rg = new THREE.CylinderGeometry(0.025, 0.025, w - 0.04, 12); rg.rotateX(Math.PI / 2);
  const rollers = new THREE.InstancedMesh(rg, mat.basic(0xb9c0c8, 0.3, 0.9), n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { m.makeTranslation(x1 + 0.05 + i * 0.1, y - 0.025, z); rollers.setMatrixAt(i, m); }
  rollers.castShadow = true; rollers.receiveShadow = true;
  g.add(rollers);
  ctx.track(rg);
  root.add(g);
  return g;
}

export { H };
