// Hallenbau, Licht, Umgebungs-Reflexion (aus der Szene gerendert), Boden-AO, Staub & Lichtkegel.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3();

/** Box-Geometrie an Position (für Merge) */
export function boxGeo(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
/** Box mit Welt-UV (Textur kachelt in Metern) */
export function boxGeoWorldUV(w, h, d, x, y, z, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const px = g.attributes.position.getX(i), py = g.attributes.position.getY(i), pz = g.attributes.position.getZ(i);
    if (ny > 0.5) uv.setXY(i, (px + x) / tile, (pz + z) / tile);
    else if (nx > 0.5) uv.setXY(i, (pz + z) / tile, (py + y) / tile);
    else uv.setXY(i, (px + x) / tile, (py + y) / tile);
  }
  g.translate(x, y, z);
  return g;
}

export function mergeToMesh(geos, material, { cast = true, receive = true, name } = {}) {
  const geo = mergeGeometries(geos.filter(Boolean), false);
  geos.forEach(g => g && g.dispose());
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast; m.receiveShadow = receive;
  if (name) m.name = name;
  return m;
}

/**
 * Halle bauen. opts:
 *  w, d, h, style ('old'|'hall'|'modern'|'robot'), floor (Material), wall (Material), wallLower (Material, optional Sockel),
 *  ceiling (Material), columns {dx, dz} | null, windows (bool), skylights (bool), doors [{side:'n'|'s'|'e'|'w', at, w, h}]
 */
export function buildHall(ctx, opts) {
  const { mat, player } = ctx;
  const { w, d, h, style = 'hall' } = opts;
  const g = new THREE.Group(); g.name = 'hall';
  const T = 0.3;

  // Boden (uv1 für gebackenes AO)
  const fg = new THREE.PlaneGeometry(w, d, 1, 1);
  fg.rotateX(-Math.PI / 2);
  fg.setAttribute('uv1', fg.attributes.uv.clone());
  const floor = new THREE.Mesh(fg, opts.floor);
  floor.receiveShadow = true;
  floor.name = 'floor';
  g.add(floor);

  // Wände
  const wallMat = opts.wall;
  const walls = [];
  const sideDef = { n: [0, -d / 2, w, 0], s: [0, d / 2, w, 0], w: [-w / 2, 0, d, Math.PI / 2], e: [w / 2, 0, d, Math.PI / 2] };
  for (const [side, [x, z, len, ry]] of Object.entries(sideDef)) {
    const doors = (opts.doors || []).filter(o => o.side === side).sort((a, b) => a.at - b.at);
    // Wand in Segmente zwischen Toren zerlegen
    let cursor = -len / 2;
    const segs = [];
    for (const dr of doors) { segs.push([cursor, dr.at - dr.w / 2]); cursor = dr.at + dr.w / 2; }
    segs.push([cursor, len / 2]);
    for (const [a, b] of segs) {
      const L = b - a; if (L <= 0.01) continue;
      const c = (a + b) / 2;
      const px = ry ? x : x + c, pz = ry ? z + c : z;
      const geo = boxGeoWorldUV(ry ? T : L, h, ry ? L : T, px, h / 2, pz, opts.wallTile || 3);
      walls.push(geo);
      player.addBoxCentered(px, pz, ry ? T : L, ry ? L : T, 0, 'wall');
    }
    // Stürze über Toren
    for (const dr of doors) {
      const lh = h - dr.h; if (lh <= 0) continue;
      const px = ry ? x : x + dr.at, pz = ry ? z + dr.at : z;
      walls.push(boxGeoWorldUV(ry ? T : dr.w, lh, ry ? dr.w : T, px, dr.h + lh / 2, pz, opts.wallTile || 3));
      player.addBoxCentered(px, pz, ry ? T : dr.w, ry ? dr.w : T, 0, 'door');   // Tore sind geschlossen
    }
  }
  const wallMesh = mergeToMesh(walls, wallMat, { name: 'walls' });
  wallMesh.castShadow = false;
  g.add(wallMesh);

  // Sockel / Anfahrschutz-Streifen (an Toröffnungen unterbrochen)
  if (opts.wallLower) {
    const lw = [];
    const hh = opts.wallLowerH || 1.2;
    const inner = { n: [0, -d / 2 + T / 2 + 0.02, w - T, false], s: [0, d / 2 - T / 2 - 0.02, w - T, false], w: [-w / 2 + T / 2 + 0.02, 0, d - T, true], e: [w / 2 - T / 2 - 0.02, 0, d - T, true] };
    for (const [side, [x, z, len, vert]] of Object.entries(inner)) {
      const doors = (opts.doors || []).filter(o => o.side === side).sort((a, b) => a.at - b.at);
      let cursor = -len / 2;
      const segs = [];
      for (const dr of doors) { segs.push([cursor, dr.at - dr.w / 2]); cursor = dr.at + dr.w / 2; }
      segs.push([cursor, len / 2]);
      for (const [a, b] of segs) {
        const L = b - a; if (L <= 0.01) continue;
        const c = (a + b) / 2;
        lw.push(vert ? boxGeoWorldUV(0.04, hh, L, x, hh / 2, z + c, 2) : boxGeoWorldUV(L, hh, 0.04, x + c, hh / 2, z, 2));
      }
    }
    g.add(mergeToMesh(lw, opts.wallLower, { cast: false, name: 'wall-lower' }));
  }

  // Decke
  const cg = new THREE.PlaneGeometry(w, d);
  cg.rotateX(Math.PI / 2);
  const ceil = new THREE.Mesh(cg, opts.ceiling || opts.wall);
  ceil.position.y = h;
  ceil.name = 'ceiling';
  g.add(ceil);

  // Binder / Träger
  const trussMat = opts.trussMat || mat.basic(style === 'old' ? 0x5a4030 : 0x5d6670, style === 'old' ? 0.85 : 0.55, style === 'old' ? 0 : 0.6);
  const tg = [];
  const span = opts.trussSpacing || 6;
  for (let z = -d / 2 + span; z < d / 2 - 0.5; z += span) {
    if (style === 'old') {
      tg.push(boxGeo(w, 0.28, 0.2, 0, h - 0.14, z));
    } else {
      tg.push(boxGeo(w, 0.06, 0.25, 0, h - 0.05, z));
      tg.push(boxGeo(w, 0.06, 0.25, 0, h - 0.95, z));
      for (let x = -w / 2 + 1; x < w / 2; x += 2) tg.push(boxGeo(0.05, 1.25, 0.05, x, h - 0.5, z, 0).rotateZ(0.0));
    }
  }
  if (tg.length) { const tm = mergeToMesh(tg, trussMat, { cast: false, name: 'trusses' }); g.add(tm); }

  // Stützen
  if (opts.columns) {
    const cgs = [], guard = [];
    const { dx, dz, skip } = opts.columns;
    for (let x = -w / 2 + dx; x < w / 2 - 0.5; x += dx) {
      for (let z = -d / 2 + dz; z < d / 2 - 0.5; z += dz) {
        if (skip && skip(x, z)) continue;
        cgs.push(boxGeo(0.32, h, 0.32, x, h / 2, z));
        guard.push(boxGeo(0.4, 1.2, 0.4, x, 0.6, z));
        player.addBoxCentered(x, z, 0.44, 0.44, 0, 'column');
      }
    }
    if (cgs.length) {
      g.add(mergeToMesh(cgs, opts.columnMat || mat.basic(0x8a9099, 0.5, 0.6), { name: 'columns' }));
      const hz = new THREE.MeshStandardMaterial({ map: mat.hazardTexture(), roughness: 0.6 });
      hz.map.repeat.set(2, 3);
      g.add(mergeToMesh(guard, hz, { name: 'column-guards' }));
    }
  }

  player.setBounds(-w / 2 + T / 2, -d / 2 + T / 2, w / 2 - T / 2, d / 2 - T / 2);
  ctx.root.add(g);
  return { group: g, floor, walls: wallMesh, ceiling: ceil };
}

/**
 * Lichtsystem: Hemisphäre + schattenwerfendes Hauptlicht (folgt dem Spieler) + Leuchten (emissiv, instanziert).
 * fixtures: Array von {x,z} ; kind: 'tube' | 'highbay' | 'panel' | 'bulb'
 */
export function setupLighting(ctx, opts) {
  const { engine, root } = ctx;
  const q = engine.q;
  const L = {};
  const hemi = new THREE.HemisphereLight(opts.sky ?? 0xdfe8f2, opts.ground ?? 0x40382e, opts.hemi ?? 0.35);
  root.add(hemi);
  L.hemi = hemi;

  const sun = new THREE.DirectionalLight(opts.keyColor ?? 0xffffff, opts.key ?? 1.6);
  const dir = new THREE.Vector3(...(opts.keyDir || [0.35, 1, 0.25])).normalize();
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  const ext = opts.shadowExtent || 14;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: 60 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  root.add(sun); root.add(sun.target);
  L.sun = sun;

  const follow = new THREE.Vector3();
  const texel = (ext * 2) / q.shadowSize;
  L.update = () => {
    engine.headPosition(follow);
    // auf Texelraster einrasten (gegen Flimmern)
    const fx = Math.round(follow.x / texel) * texel, fz = Math.round(follow.z / texel) * texel;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + dir.x * 25, dir.y * 25, fz + dir.z * 25);
  };
  L.update();
  ctx.onUpdate(L.update);

  // Leuchten
  const fixtures = opts.fixtures || [];
  if (fixtures.length) {
    const kind = opts.fixtureKind || 'highbay';
    const fh = opts.fixtureHeight ?? 6;
    let geo, housingGeo;
    if (kind === 'tube') { geo = new THREE.BoxGeometry(1.5, 0.035, 0.06); housingGeo = new THREE.BoxGeometry(1.56, 0.06, 0.16); }
    else if (kind === 'panel') { geo = new THREE.BoxGeometry(1.2, 0.02, 0.6); housingGeo = new THREE.BoxGeometry(1.24, 0.05, 0.64); }
    else if (kind === 'bulb') { geo = new THREE.SphereGeometry(0.07, 16, 10); housingGeo = new THREE.ConeGeometry(0.22, 0.16, 20, 1, true); }
    else { geo = new THREE.CylinderGeometry(0.26, 0.26, 0.03, 28); housingGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.22, 28); }
    const emi = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: opts.lampColor ?? 0xfff4e0, emissiveIntensity: opts.lampIntensity ?? 6, toneMapped: true });
    const hou = new THREE.MeshStandardMaterial({ color: kind === 'bulb' ? 0x2d3f33 : 0xb9bec4, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
    const lamps = new THREE.InstancedMesh(geo, emi, fixtures.length);
    const houses = new THREE.InstancedMesh(housingGeo, hou, fixtures.length);
    const m = new THREE.Matrix4(), mh = new THREE.Matrix4();
    fixtures.forEach((f, i) => {
      const ry = f.ry || 0;
      const y = f.y ?? fh;
      m.compose(new THREE.Vector3(f.x, y - (kind === 'bulb' ? 0.1 : 0.03), f.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
      mh.compose(new THREE.Vector3(f.x, y + (kind === 'bulb' ? -0.02 : 0.03), f.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(i, m); houses.setMatrixAt(i, mh);
    });
    lamps.computeBoundingSphere(); houses.computeBoundingSphere();
    root.add(lamps); root.add(houses);
    L.lamps = lamps;
    // Pendel/Kabel
    if (opts.cables !== false) {
      const pts = [];
      fixtures.forEach(f => { const y = f.y ?? fh; pts.push(f.x, y + 0.05, f.z, f.x, opts.ceilingY ?? (y + 1.2), f.z); });
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x222222 })));
    }
  }

  // wenige Punktlichter für lokale Stimmung
  L.points = [];
  for (const p of (opts.points || [])) {
    const pl = new THREE.PointLight(p.color ?? 0xffe2b0, p.intensity ?? 6, p.distance ?? 9, 2);
    pl.position.set(p.x, p.y, p.z);
    root.add(pl);
    L.points.push(pl);
  }

  // Kein Nebel/Dunst: klare Sicht durch die ganze Halle (Wunsch der Lehrkraft)
  ctx.engine.scene.fog = null;
  // Belichtung je Lager (wie bei einer Kamera); 1 = neutral
  ctx.engine.renderer.toneMappingExposure = opts.exposure ?? 1.0;
  if (opts.background != null) ctx.engine.scene.background = new THREE.Color(opts.background);
  return L;
}

/**
 * Umgebungs-Reflexion aus der Szene rendern (2 Durchgänge ≈ eine Lichtbounce).
 */
export function captureEnvironment(ctx, position, { intensity = 1, passes = 2, hide = [] } = {}) {
  const { engine } = ctx;
  const r = engine.renderer;
  const pm = new THREE.PMREMGenerator(r);
  const scene = engine.scene;
  const hidden = [];
  const toHide = [engine.rig, ...hide];
  scene.traverse(o => { if (o.userData.noEnvCapture) toHide.push(o); });
  for (const o of toHide) if (o && o.visible) { o.visible = false; hidden.push(o); }
  const savedFog = scene.fog; scene.fog = null;
  let rt = null;
  const prevEnv = scene.environment;
  for (let i = 0; i < passes; i++) {
    const next = pm.fromScene(scene, 0.03, 0.05, 120, { size: engine.q.envSize, position });
    if (rt) rt.dispose();
    rt = next;
    scene.environment = rt.texture;
    scene.environmentIntensity = intensity;
  }
  scene.fog = savedFog;
  for (const o of hidden) o.visible = true;
  pm.dispose();
  if (prevEnv && prevEnv !== rt.texture && prevEnv.dispose) prevEnv.dispose();
  ctx.track(rt);
  return rt;
}

/**
 * Boden-Ambient-Occlusion aus Grundrissen backen.
 * footprints: [{x,z,w,d, s (Stärke 0..1), blur (m)}] in Weltkoordinaten (Hallenmitte = 0,0)
 */
export function bakeFloorAO(ctx, floorMesh, W, D, footprints, { res = 1024, edge = 0.5, edgeStrength = 0.35 } = {}) {
  const aspect = W / D;
  const cw = aspect >= 1 ? res : Math.round(res * aspect);
  const ch = aspect >= 1 ? Math.round(res / aspect) : res;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);
  const sx = cw / W, sz = ch / D;
  const hasFilter = 'filter' in g;
  // Randabdunklung an den Wänden
  const eg = edge * sx;
  const grads = [
    [0, 0, eg, 0, 0, 0, eg, ch], [cw, 0, cw - eg, 0, cw - eg, 0, eg, ch],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of grads) {
    const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, `rgba(0,0,0,${edgeStrength})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(rx, ry, rw, rh);
  }
  const ez = edge * sz;
  let gr = g.createLinearGradient(0, 0, 0, ez); gr.addColorStop(0, `rgba(0,0,0,${edgeStrength})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, cw, ez);
  gr = g.createLinearGradient(0, ch, 0, ch - ez); gr.addColorStop(0, `rgba(0,0,0,${edgeStrength})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, ch - ez, cw, ez);

  for (const f of footprints) {
    const blur = (f.blur ?? 0.25) * sx;
    const a = f.s ?? 0.55;
    const x = (f.x + W / 2 - f.w / 2) * sx, y = (f.z + D / 2 - f.d / 2) * sz;
    const w = f.w * sx, h = f.d * sz;
    if (hasFilter) {
      g.filter = `blur(${Math.max(1, blur)}px)`;
      g.fillStyle = `rgba(0,0,0,${a})`;
      g.fillRect(x, y, w, h);
      g.filter = 'none';
    } else {
      g.shadowColor = `rgba(0,0,0,${a})`; g.shadowBlur = blur * 2; g.shadowOffsetX = 10000;
      g.fillStyle = '#000'; g.fillRect(x - 10000, y, w, h);
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.channel = 1;
  t.colorSpace = THREE.NoColorSpace;
  ctx.track(t);
  const m = floorMesh.material;
  m.aoMap = t;
  m.aoMapIntensity = 1;
  m.needsUpdate = true;
  return t;
}

/** schwebender Staub im Licht */
export function dust(ctx, { minX, maxX, minZ, maxZ, minY = 0.3, maxY = 4, count = 500, color = 0xfff1d6, size = 0.018, opacity = 0.5 }) {
  if (!ctx.engine.q.particles) return null;
  const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = minX + Math.random() * (maxX - minX);
    pos[i * 3 + 1] = minY + Math.random() * (maxY - minY);
    pos[i * 3 + 2] = minZ + Math.random() * (maxZ - minZ);
    vel[i * 3] = (Math.random() - 0.5) * 0.03; vel[i * 3 + 1] = (Math.random() - 0.5) * 0.015; vel[i * 3 + 2] = (Math.random() - 0.5) * 0.03;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sprite = document.createElement('canvas'); sprite.width = sprite.height = 32;
  const sg = sprite.getContext('2d'); const rg = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); sg.fillStyle = rg; sg.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(sprite); ctx.track(tex);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.userData.noEnvCapture = true;
  ctx.root.add(pts);
  ctx.onUpdate(dt => {
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i * 3 + k] * dt;
      if (pos[i * 3 + 1] < minY) pos[i * 3 + 1] = maxY; if (pos[i * 3 + 1] > maxY) pos[i * 3 + 1] = minY;
      if (pos[i * 3] < minX) pos[i * 3] = maxX; if (pos[i * 3] > maxX) pos[i * 3] = minX;
      if (pos[i * 3 + 2] < minZ) pos[i * 3 + 2] = maxZ; if (pos[i * 3 + 2] > maxZ) pos[i * 3 + 2] = minZ;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return pts;
}

/** Lichtkegel/-schacht (z. B. durch Fenster) – additive, zur Spitze hin ausblendend */
export function lightShaft(ctx, from, to, { width = 1.2, color = 0xfff0d0, opacity = 0.12 } = {}) {
  const len = from.distanceTo(to);
  const geo = new THREE.CylinderGeometry(width * 0.5, width * 0.85, len, 4, 1, true);
  geo.rotateY(Math.PI / 4);
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0.0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c); ctx.track(tex);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v.copy(from).sub(to).normalize());
  m.userData.noEnvCapture = true;
  m.renderOrder = 3;
  ctx.root.add(m);
  return m;
}

/** Bodenmarkierung (Streifen) als flache Quads, gemerged. lines: [{x1,z1,x2,z2,w}] */
export function floorLines(ctx, lines, { color = 0xf2c21b, roughness = 0.55, y = 0.003, texture = null } = {}) {
  const geos = lines.map(l => {
    const dx = l.x2 - l.x1, dz = l.z2 - l.z1, len = Math.hypot(dx, dz);
    const g = new THREE.PlaneGeometry(len, l.w ?? 0.1);
    g.rotateX(-Math.PI / 2);
    g.rotateY(-Math.atan2(dz, dx));
    g.translate((l.x1 + l.x2) / 2, y, (l.z1 + l.z2) / 2);
    return g;
  });
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, map: texture, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = mergeToMesh(geos, m, { cast: false, name: 'floor-lines' });
  ctx.root.add(mesh);
  return mesh;
}
