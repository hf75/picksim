// LAGER 02 – Palettenregale (prozedural, alle Zeilen zu wenigen Draw-Calls zusammengefasst)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxGeo, mergeToMesh } from '../../core/env.js';

export const RACK = {
  BAY_W: 2.7, BAYS: 6, DEPTH: 1.0,
  BEAMS: [1.70, 3.40, 5.10],          // Mittelhöhe der Traversen (Ebene 1–3)
  UPRIGHT_H: 6.4, POST_W: 0.09, POST_D: 0.075, BEAM_H: 0.12, BEAM_T: 0.05,
  SLOT: 1.35,                          // 2 Paletten je Feld
};

/** Mittelpunkt z der Palettenposition p (0 = vorne am Hauptgang) */
export const slotZ = (zFront, p) => zFront - RACK.SLOT * (p + 0.5);
/** Unterkante der Palette auf Ebene L */
export const levelY = L => (L === 0 ? 0 : RACK.BEAMS[L - 1] + RACK.BEAM_H / 2);

/**
 * rows: [{ x, face (+1 Front nach +X / −1 nach −X) }]
 */
export function buildRacks(ctx, rows, zFront) {
  const { mat } = ctx;
  const R = RACK;
  const posts = [], beams = [], braces = [], feet = [], guards = [], ends = [];
  for (const row of rows) {
    const { x, face } = row;
    for (let k = 0; k <= R.BAYS; k++) {
      const z = zFront - k * R.BAY_W;
      const zz = k === 0 ? z - R.POST_W / 2 : k === R.BAYS ? z + R.POST_W / 2 : z;
      for (const side of [-1, 1]) {
        const px = x + side * (R.DEPTH / 2 - R.POST_D / 2);
        posts.push(boxGeo(R.POST_D, R.UPRIGHT_H, R.POST_W, px, R.UPRIGHT_H / 2, zz));
        feet.push(boxGeo(0.14, 0.012, 0.17, px, 0.006, zz));
      }
      // Rahmen-Diagonalen in der X-Y-Ebene
      const x0 = x - R.DEPTH / 2 + R.POST_D, x1 = x + R.DEPTH / 2 - R.POST_D;
      const span = x1 - x0;
      let y = 0.15, dir = 1;
      const step = 0.62;
      braces.push(boxGeo(span, 0.03, 0.026, x, y, zz));
      while (y + step < R.UPRIGHT_H - 0.15) {
        const y2 = y + step, len = Math.hypot(span, step);
        const g = new THREE.BoxGeometry(len, 0.026, 0.022);
        g.rotateZ(Math.atan2(step, span) * dir);
        g.translate(x, (y + y2) / 2, zz);
        braces.push(g);
        y = y2; dir = -dir;
      }
      braces.push(boxGeo(span, 0.03, 0.026, x, y, zz));
      // Ständerschutz (gelb) auf der Gangseite
      const ax = x + face * (R.DEPTH / 2 - R.POST_D / 2);
      guards.push(boxGeo(0.13, 0.36, 0.14, ax + face * 0.025, 0.18, zz));
    }
    // Traversen vorne & hinten je Feld und Ebene
    for (let b = 0; b < R.BAYS; b++) {
      const zc = zFront - (b + 0.5) * R.BAY_W;
      const blen = R.BAY_W - R.POST_W;
      for (const by of R.BEAMS) for (const side of [-1, 1]) {
        const bx = x + side * (R.DEPTH / 2 - R.BEAM_T / 2);
        beams.push(boxGeo(R.BEAM_T, R.BEAM_H, blen, bx, by, zc));
        // Verbinder-Laschen (kleine dunkle Klötze an den Enden)
      }
    }
    // Rammschutz an der Stirnseite (L-Bügel, gelb-schwarz)
    ends.push(boxGeo(R.DEPTH + 0.1, 0.42, 0.09, x, 0.21, zFront + 0.42));
    for (const side of [-1, 1]) ends.push(boxGeo(0.09, 0.42, 0.42, x + side * (R.DEPTH / 2 + 0.005), 0.21, zFront + 0.21));
  }

  const g = new THREE.Group();
  g.name = 'pallet-racks';
  const upTex = mat.uprightTexture('#1f4fa3').clone();
  upTex.repeat.set(1, R.UPRIGHT_H);
  upTex.needsUpdate = true;
  ctx.track(upTex);
  const upMat = new THREE.MeshStandardMaterial({ map: upTex, color: 0xffffff, roughness: 0.48, metalness: 0.35 });
  ctx.track(upMat);
  g.add(mergeToMesh(posts, upMat, { name: 'uprights' }));
  const beamMat = mat.pbr('metal_painted', { color: 0xff6a12, repeat: [3, 0.25], fallbackColor: 0xf07a1e, roughness: 1, metalness: 1, tag: 'l2beam' });
  g.add(mergeToMesh(beams, beamMat, { name: 'beams' }));
  g.add(mergeToMesh(braces, mat.basic(0x1f4fa3, 0.5, 0.35), { name: 'braces', cast: false }));
  g.add(mergeToMesh(feet, mat.pbr('metal_galvanized', { repeat: [1, 1], fallbackColor: 0xb8bcc0, tag: 'l2feet' }), { name: 'feet', cast: false }));
  g.add(mergeToMesh(guards, mat.basic(0xf2c21b, 0.45, 0.2), { name: 'post-guards' }));
  const hz = new THREE.MeshStandardMaterial({ map: mat.hazardTexture().clone(), roughness: 0.5, metalness: 0.2 });
  hz.map.repeat.set(3, 1); hz.map.needsUpdate = true; ctx.track(hz.map); ctx.track(hz);
  g.add(mergeToMesh(ends, hz, { name: 'end-guards' }));
  ctx.root.add(g);
  return g;
}

/**
 * Etiketten an den Traversen: items = [{ x (Front-x), face, y, z, uv }]
 * Ebene 0 hängt an der Traverse von Ebene 1 (Pfeil nach unten).
 */
export function rackLabels(ctx, items, atlasTex, { w = 0.21, h = 0.079 } = {}) {
  const geos = items.map(it => {
    const p = new THREE.PlaneGeometry(it.w || w, it.h || h);
    const a = p.attributes.uv;
    for (let i = 0; i < a.count; i++) a.setXY(i, it.uv.u + a.getX(i) * it.uv.w, it.uv.v + a.getY(i) * it.uv.h);
    p.rotateY(it.face * Math.PI / 2);
    p.translate(it.x + it.face * 0.004, it.y, it.z);
    return p;
  });
  const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: atlasTex, roughness: 0.45, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 }));
  geos.forEach(x => x.dispose());
  m.name = 'rack-labels';
  m.receiveShadow = true;
  ctx.track(m.geometry); ctx.track(m.material);
  ctx.root.add(m);
  return m;
}
