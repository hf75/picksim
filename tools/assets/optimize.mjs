// PickSim asset pipeline, step 3: raw GLB (from convert_blender.py) -> web/Quest-ready GLB + manifest.json
//
//   node optimize.mjs [--raw DIR] [--out DIR] [--only id1,id2] [--modules DIR] [--preview DIR]
//
// --modules: node_modules folder containing @gltf-transform/{core,functions,extensions} 4.x, meshoptimizer, sharp
//            (default: env PICKSIM_NODE_MODULES or %TEMP%\picksim-node-tools\node_modules)
// --raw:     Blender output (default: env PICKSIM_RAW_GLB or %TEMP%\picksim-asset-cache\_raw_glb)
// --out:     target folder (default: <project>/assets/models)
// --preview: optional folder; additionally writes an uncompressed copy of every GLB (for Blender previews)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const TEMP = process.env.TEMP || process.env.TMPDIR || '/tmp';
const MODULES = arg('--modules', process.env.PICKSIM_NODE_MODULES || path.join(TEMP, 'picksim-node-tools', 'node_modules'));
const RAW = arg('--raw', process.env.PICKSIM_RAW_GLB || path.join(TEMP, 'picksim-asset-cache', '_raw_glb'));
const OUT = arg('--out', path.resolve(HERE, '..', '..', 'assets', 'models'));
const PREVIEW = arg('--preview', null);
const ONLY = new Set((arg('--only', '') || '').split(',').filter(Boolean));
const CFG = JSON.parse(fs.readFileSync(arg('--list', path.join(HERE, 'assets.json')), 'utf8'));

// ---- load modules from an external node_modules folder (keeps the project folder free of node_modules)
async function load(pkg) {
  const dir = path.join(MODULES, ...pkg.split('/'));
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  let entry = pj.main || 'index.js';
  const ex = pj.exports && (pj.exports['.'] || pj.exports);
  const pick = (e) => typeof e === 'string' ? e : e && (pick(e.import) || pick(e.default));
  if (ex) entry = pick(ex) || entry;
  return import(pathToFileURL(path.join(dir, entry)).href);
}
const { NodeIO, Primitive, PropertyType } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTTextureWebP } = await load('@gltf-transform/extensions');
const F = await load('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await load('meshoptimizer');
const sharp = (await load('sharp')).default;
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const STRIP_EXT = ['KHR_materials_specular', 'KHR_materials_ior', 'KHR_materials_transmission', 'KHR_materials_volume',
  'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_iridescence', 'KHR_materials_anisotropy',
  'KHR_materials_dispersion', 'KHR_materials_diffuse_transmission', 'KHR_materials_variants'];

const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lin2srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

// ------------------------------------------------------------------------------------------------
// material hints written by convert_blender.py (material extras "ps")
async function applyMaterialHints(doc, notes) {
  const root = doc.getRoot();
  const hints = new Map();
  for (const mat of root.listMaterials()) {
    let ps = {};
    const ex = mat.getExtras() || {};
    if (typeof ex.ps === 'string') { try { ps = JSON.parse(ex.ps); } catch { /* ignore */ } }
    hints.set(mat, ps);
    mat.setExtras({});
    // SimReady names transparent materials "trans__<kind>__..."; their UsdPreviewSurface fallback is often fully
    // opaque (the transparency lives only in the OmniGlass MDL) or nearly invisible (opacity 0.01..0.05)
    const mname = mat.getName() || '';
    if (/(^|_)trans__/i.test(mname)) {
      const glass = /glass/i.test(mname);
      const f = mat.getBaseColorFactor();
      let a = mat.getAlphaMode() === 'OPAQUE' || f[3] > 0.95 ? (glass ? 0.25 : 0.35) : f[3];
      a = Math.max(a, glass ? 0.12 : 0.2);
      mat.setAlphaMode('BLEND').setBaseColorFactor([f[0], f[1], f[2], a]);
    }
    // transmission (glass) -> simple alpha blend, cheaper on Quest than MeshPhysicalMaterial
    const tr = mat.getExtension('KHR_materials_transmission');
    if (tr && tr.getTransmissionFactor() > 0) {
      const f = mat.getBaseColorFactor();
      mat.setAlphaMode('BLEND').setBaseColorFactor([f[0], f[1], f[2], Math.min(f[3], 0.35)]);
    }
    if (ps.ps_tint) {
      const f = mat.getBaseColorFactor();
      mat.setBaseColorFactor([f[0] * ps.ps_tint[0], f[1] * ps.ps_tint[1], f[2] * ps.ps_tint[2], f[3]]);
    }
    if (ps.ps_albedo_adjust && mat.getBaseColorTexture()) {
      // OmniPBR: c' = clamp(lerp(c, lum(c), desat) * brightness + add), in linear space; baked into a copy
      const [desat, add, bright] = ps.ps_albedo_adjust;
      const t = mat.getBaseColorTexture();
      const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 4) {
        const r = srgb2lin(data[i] / 255), g = srgb2lin(data[i + 1] / 255), b = srgb2lin(data[i + 2] / 255);
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const o = [r, g, b].map((c) => Math.min(1, Math.max(0, (c * (1 - desat) + l * desat) * bright + add)));
        data[i] = Math.round(lin2srgb(o[0]) * 255); data[i + 1] = Math.round(lin2srgb(o[1]) * 255); data[i + 2] = Math.round(lin2srgb(o[2]) * 255);
      }
      const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
      const nt = doc.createTexture(`${t.getName()}_adj`).setImage(png).setMimeType('image/png');
      mat.setBaseColorTexture(nt);
    }
    if (ps.ps_opacity_tex && fs.existsSync(ps.ps_opacity_tex)) {
      const bt = mat.getBaseColorTexture();
      let base;
      if (bt) base = sharp(Buffer.from(bt.getImage()));
      else {
        const f = mat.getBaseColorFactor();
        base = sharp({ create: { width: 512, height: 512, channels: 3, background: { r: Math.round(lin2srgb(f[0]) * 255), g: Math.round(lin2srgb(f[1]) * 255), b: Math.round(lin2srgb(f[2]) * 255) } } });
        const f2 = mat.getBaseColorFactor(); mat.setBaseColorFactor([1, 1, 1, f2[3]]);
      }
      const bm = await base.clone().metadata();
      const W = bm.width || 512, H = bm.height || 512;
      let op = sharp(ps.ps_opacity_tex).resize(W, H, { fit: 'fill' });
      op = (ps.ps_opacity_mode === 'mono_alpha') ? op.ensureAlpha().extractChannel(3) : op.greyscale().extractChannel(0);
      const alpha = await op.raw().toBuffer();
      const rgba = await base.removeAlpha().joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
      const nt = doc.createTexture(`${mat.getName()}_rgba`).setImage(rgba).setMimeType('image/png');
      mat.setBaseColorTexture(nt);
      if (!bt) notes.add('Opazitätstextur ohne Albedo');
    }
    if (typeof ps.ps_opacity === 'number') {
      const f = mat.getBaseColorFactor();
      mat.setBaseColorFactor([f[0], f[1], f[2], ps.ps_opacity]);
    }
    if (ps.ps_alpha) mat.setAlphaMode(ps.ps_alpha);
    if (ps.ps_alpha_cutoff) mat.setAlphaCutoff(Math.min(0.9, Math.max(0.05, ps.ps_alpha_cutoff)));
    if (typeof ps.ps_metallic === 'number') mat.setMetallicFactor(ps.ps_metallic);
    if (typeof ps.ps_roughness === 'number') mat.setRoughnessFactor(ps.ps_roughness);
  }
  return hints;
}

function stripExtensions(doc) {
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (STRIP_EXT.includes(ext.extensionName)) ext.dispose();
  }
}

function cleanAttributes(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const used = new Set();
      if (mat) {
        for (const ti of [mat.getBaseColorTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getNormalTextureInfo(),
          mat.getOcclusionTextureInfo(), mat.getEmissiveTextureInfo()]) {
          if (ti && ti.getTexCoord !== undefined) used.add(ti.getTexCoord());
        }
      }
      for (const sem of prim.listSemantics()) {
        if (sem.startsWith('COLOR_') || sem === 'TANGENT' || sem.startsWith('_')) prim.setAttribute(sem, null);
        const m = /^TEXCOORD_(\d+)$/.exec(sem);
        if (m && Number(m[1]) > 0 && !used.has(Number(m[1]))) prim.setAttribute(sem, null);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// simplification with one global error threshold (meters) for the whole asset, binary-searched to the budget
function sceneTris(doc) {
  let n = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(n);
}

function simplifyGlobal(doc, maxTris, diag, log, maxErr = null) {
  const root = doc.getRoot();
  const users = new Map(), scale = new Map();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const s = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
    users.set(mesh, (users.get(mesh) || 0) + 1);
    scale.set(mesh, Math.max(scale.get(mesh) || 0, s));
  }
  const items = [];
  for (const mesh of root.listMeshes()) {
    if (!users.get(mesh)) continue;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES || !prim.getIndices()) continue;
      const positions = Float32Array.from(prim.getAttribute('POSITION').getArray());
      const nrm = prim.getAttribute('NORMAL');
      items.push({
        prim, positions, normals: nrm ? Float32Array.from(nrm.getArray()) : null,
        indices: Uint32Array.from(prim.getIndices().getArray()), scale: scale.get(mesh) || 1, users: users.get(mesh),
      });
    }
  }
  const before = items.reduce((a, it) => a + it.indices.length / 3 * it.users, 0);
  const run = (err) => items.map((it) => {
    const e = err / it.scale;
    const flags = ['ErrorAbsolute', 'Prune'];
    const r = it.normals
      ? MeshoptSimplifier.simplifyWithAttributes(it.indices, it.positions, 3, it.normals, 3, [0.5, 0.5, 0.5], null, 0, e, flags)
      : MeshoptSimplifier.simplify(it.indices, it.positions, 3, 0, e, flags);
    return r[0];
  });
  const count = (res) => res.reduce((a, r, i) => a + r.length / 3 * items[i].users, 0);
  const eMin = Math.max(0.00005, diag * 0.00005);
  // 2.5 % of the diagonal: beyond that thin features (lattices, slots) start to break up visibly
  const eMax = maxErr ? Math.max(eMin * 1.01, maxErr) : diag * 0.025;
  let best = null, bestErr = 0;
  let res = run(eMin);
  if (count(res) <= maxTris) { best = res; bestErr = eMin; }
  else {
    let lo = Math.log(eMin), hi = Math.log(eMax);
    const top = run(eMax);
    if (count(top) > maxTris) { best = top; bestErr = eMax; }
    else {
      best = top; bestErr = eMax;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const r = run(Math.exp(mid));
        if (count(r) <= maxTris) { best = r; bestErr = Math.exp(mid); hi = mid; } else lo = mid;
        if (hi - lo < 0.02) break;
      }
    }
  }
  items.forEach((it, i) => {
    const idx = best[i];
    if (idx.length === it.indices.length) return;
    if (idx.length === 0) {
      it.prim.dispose();
      return;
    }
    const old = it.prim.getIndices();
    const acc = doc.createAccessor().setType('SCALAR').setArray(it.positions.length / 3 > 65535 ? idx : Uint16Array.from(idx))
      .setBuffer(old.getBuffer());
    it.prim.setIndices(acc);
    if (old.listParents().length <= 1) old.dispose();
    F.compactPrimitive(it.prim);
  });
  for (const mesh of root.listMeshes()) if (!mesh.listPrimitives().length) mesh.dispose();
  const after = count(best);
  log.push(`simplify ${before} -> ${after} tris (err ${(bestErr * 1000).toFixed(2)} mm, ${(bestErr / diag * 100).toFixed(3)}% diag)`);
  return { before, after, err: bestErr };
}

// ------------------------------------------------------------------------------------------------
// After heavy simplification the authored vertex normals (made for the dense mesh) produce smeared, triangular
// shading on large flat faces. Recompute them from the simplified surface with an auto-smooth angle: corners
// sharper than `angleDeg` get split normals, smooth regions stay smooth; UV seams are kept.
function autoSmoothNormals(doc, prim, angleDeg = 45) {
  const posAcc = prim.getAttribute('POSITION'), idxAcc = prim.getIndices();
  if (!posAcc || !idxAcc || !prim.getAttribute('NORMAL')) return;
  const P = posAcc.getArray(), I = idxAcc.getArray();
  const nv = posAcc.getCount(), nt = I.length / 3;
  const keyMap = new Map(), pid = new Uint32Array(nv);
  for (let v = 0; v < nv; v++) {
    const k = `${P[3 * v]},${P[3 * v + 1]},${P[3 * v + 2]}`;
    let id = keyMap.get(k);
    if (id === undefined) { id = keyMap.size; keyMap.set(k, id); }
    pid[v] = id;
  }
  const fn = new Float32Array(nt * 3);   // area-weighted face normals
  for (let t = 0; t < nt; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    fn[3 * t] = uy * vz - uz * vy; fn[3 * t + 1] = uz * vx - ux * vz; fn[3 * t + 2] = ux * vy - uy * vx;
  }
  const unit = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  // faces around each welded position
  const start = new Uint32Array(keyMap.size + 1);
  for (let i = 0; i < I.length; i++) start[pid[I[i]] + 1]++;
  for (let i = 0; i < keyMap.size; i++) start[i + 1] += start[i];
  const fill = start.slice(0, keyMap.size), corner = new Uint32Array(I.length);
  for (let i = 0; i < I.length; i++) corner[fill[pid[I[i]]]++] = i;
  const cosT = Math.cos(angleDeg * Math.PI / 180);
  const cornerNormal = new Float32Array(I.length * 3);
  for (let p = 0; p < keyMap.size; p++) {
    for (let j = start[p]; j < start[p + 1]; j++) {
      const ci = corner[j], ti = Math.floor(ci / 3);
      const n0 = unit(fn[3 * ti], fn[3 * ti + 1], fn[3 * ti + 2]);
      let sx = 0, sy = 0, sz = 0;
      for (let k = start[p]; k < start[p + 1]; k++) {
        const tk = Math.floor(corner[k] / 3);
        const nk = unit(fn[3 * tk], fn[3 * tk + 1], fn[3 * tk + 2]);
        if (n0[0] * nk[0] + n0[1] * nk[1] + n0[2] * nk[2] >= cosT) { sx += fn[3 * tk]; sy += fn[3 * tk + 1]; sz += fn[3 * tk + 2]; }
      }
      const n = unit(sx, sy, sz);
      cornerNormal.set(n, 3 * ci);
    }
  }
  // one output vertex per (input vertex, quantised normal)
  const sems = prim.listSemantics();
  const src = sems.map((s) => [s, prim.getAttribute(s)]);
  const outIdx = new Uint32Array(I.length), vkey = new Map(), order = [], normals = [];
  for (let i = 0; i < I.length; i++) {
    const n = cornerNormal.subarray(3 * i, 3 * i + 3);
    const k = `${I[i]}|${Math.round(n[0] * 1000)},${Math.round(n[1] * 1000)},${Math.round(n[2] * 1000)}`;
    let o = vkey.get(k);
    if (o === undefined) { o = order.length; vkey.set(k, o); order.push(I[i]); normals.push(n[0], n[1], n[2]); }
    outIdx[i] = o;
  }
  const buf = idxAcc.getBuffer();
  for (const [s, acc] of src) {
    const size = acc.getElementSize();
    const Ctor = acc.getArray().constructor;
    const arr = s === 'NORMAL' ? new Float32Array(normals) : new Ctor(order.length * size);
    if (s !== 'NORMAL') {
      const a = acc.getArray();
      for (let i = 0; i < order.length; i++) for (let c = 0; c < size; c++) arr[i * size + c] = a[order[i] * size + c];
    }
    prim.setAttribute(s, doc.createAccessor().setType(acc.getType()).setArray(arr).setNormalized(acc.getNormalized()).setBuffer(acc.getBuffer()));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(order.length > 65535 ? outIdx : Uint16Array.from(outIdx)).setBuffer(buf));
}

// ------------------------------------------------------------------------------------------------
// textures
const statCache = new Map();
async function texStats(tex) {
  if (statCache.has(tex)) return statCache.get(tex);
  const buf = Buffer.from(tex.getImage());
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf).resize(256, 256, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, n = data.length / ch;
  const mean = new Array(ch).fill(0), sq = new Array(ch).fill(0);
  for (let i = 0; i < data.length; i += ch) for (let c = 0; c < ch; c++) { mean[c] += data[i + c]; sq[c] += data[i + c] ** 2; }
  for (let c = 0; c < ch; c++) { mean[c] /= n; sq[c] = Math.sqrt(Math.max(0, sq[c] / n - mean[c] ** 2)); }
  // 99th percentile of the largest per-pixel deviation from the mean (catches small labels/engravings on flat maps)
  const dev = new Float32Array(n);
  for (let i = 0, k = 0; i < data.length; i += ch, k++) {
    let d = 0;
    for (let c = 0; c < Math.min(ch, 3); c++) d = Math.max(d, Math.abs(data[i + c] - mean[c]));
    dev[k] = d;
  }
  dev.sort();
  const s = { w: meta.width, h: meta.height, ch, mean, std: sq, p99: dev[Math.floor(n * 0.99)] };
  statCache.set(tex, s);
  return s;
}

function copyTexInfo(src, dst) {
  if (!src || !dst) return;
  dst.setTexCoord(src.getTexCoord());
  dst.setWrapS(src.getWrapS()).setWrapT(src.getWrapT());
  if (src.getMagFilter() != null) dst.setMagFilter(src.getMagFilter());
  if (src.getMinFilter() != null) dst.setMinFilter(src.getMinFilter());
  const tt = src.getExtension('KHR_texture_transform');
  if (tt) dst.setExtension('KHR_texture_transform', tt.clone());
}

async function assignOcclusion(doc, hints) {
  let n = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    const mr = mat.getMetallicRoughnessTexture();
    if (!mr || mat.getOcclusionTexture()) continue;
    const name = `${mr.getName()} ${mr.getURI()}`;
    if (!/orm/i.test(name) && !(hints.get(mat) || {}).ps_orm) continue;
    mat.setOcclusionTexture(mr).setOcclusionStrength(1);
    copyTexInfo(mat.getMetallicRoughnessTextureInfo(), mat.getOcclusionTextureInfo());
    n++;
  }
  return n;
}

const UNIFORM = 2.5; // std-dev (0..255) below which a map counts as constant
async function factorizeTextures(doc, notes) {
  for (const mat of doc.getRoot().listMaterials()) {
    const bt = mat.getBaseColorTexture();
    if (bt) {
      const s = await texStats(bt);
      const alphaFlat = s.ch < 4 || s.std[3] < 1;
      if (Math.max(s.std[0], s.std[1], s.std[2]) < UNIFORM && s.p99 < 10 && alphaFlat) {
        const f = mat.getBaseColorFactor();
        const a = s.ch === 4 ? s.mean[3] / 255 : 1;
        mat.setBaseColorFactor([0, 1, 2].map((i) => f[i] * srgb2lin(s.mean[i] / 255)).concat([f[3] * a]));
        mat.setBaseColorTexture(null);
      }
    }
    const nt = mat.getNormalTexture();
    if (nt) {
      const s = await texStats(nt);
      if (s.std[0] < 1.5 && s.std[1] < 1.5 && s.p99 < 8) mat.setNormalTexture(null);
    }
    const mr = mat.getMetallicRoughnessTexture();
    if (mr) {
      const s = await texStats(mr);
      if (s.std[1] < UNIFORM && s.std[2] < UNIFORM && s.p99 < 12) {
        mat.setRoughnessFactor(mat.getRoughnessFactor() * s.mean[1] / 255);
        mat.setMetallicFactor(mat.getMetallicFactor() * s.mean[2] / 255);
        mat.setMetallicRoughnessTexture(null);
      }
    }
    // keep the ORM as occlusionTexture whenever the texture stays bound anyway (as requested: AO from ORM.r);
    // drop it only if it would remain solely for a constant AO channel
    const oc = mat.getOcclusionTexture();
    if (oc && oc !== mat.getMetallicRoughnessTexture()) {
      const s = await texStats(oc);
      if (s.std[0] < UNIFORM && s.p99 < 12) mat.setOcclusionTexture(null);
    }
    const et = mat.getEmissiveTexture();
    if (et) {
      const s = await texStats(et);
      if (Math.max(s.mean[0], s.mean[1], s.mean[2]) < 2) { mat.setEmissiveTexture(null); mat.setEmissiveFactor([0, 0, 0]); }
      else if (Math.max(s.std[0], s.std[1], s.std[2]) < UNIFORM) {
        const f = mat.getEmissiveFactor();
        mat.setEmissiveFactor([0, 1, 2].map((i) => f[i] * srgb2lin(s.mean[i] / 255)));
        mat.setEmissiveTexture(null);
      }
    }
  }
}

function textureUsage(doc) {
  const use = new Map();
  const add = (t, slot, mat) => { if (!t) return; const u = use.get(t) || { slots: new Set(), mats: new Set() }; u.slots.add(slot); u.mats.add(mat); use.set(t, u); };
  for (const mat of doc.getRoot().listMaterials()) {
    add(mat.getBaseColorTexture(), 'base', mat);
    add(mat.getMetallicRoughnessTexture(), 'mr', mat);
    add(mat.getOcclusionTexture(), 'occ', mat);
    add(mat.getNormalTexture(), 'normal', mat);
    add(mat.getEmissiveTexture(), 'emissive', mat);
  }
  return use;
}

async function encodeTextures(doc, maxTex, scale = 1, texCap = 1e12) {
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const use = textureUsage(doc);
  for (const [tex, u] of use) {
    const s = await texStats(tex);
    let limit = maxTex * scale;
    if (u.slots.has('emissive') && u.slots.size === 1) limit /= 2;
    if (Math.max(...s.std.slice(0, 3)) < 6) limit /= 2;          // nearly flat maps: half resolution is plenty
    limit = Math.max(64, Math.min(limit, Math.max(s.w, s.h)));
    const needAlpha = u.slots.has('base') && [...u.mats].some((m) => m.getAlphaMode() !== 'OPAQUE');
    let img = sharp(Buffer.from(tex.getImage())).resize(Math.round(limit), Math.round(limit), { fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true });
    if (!needAlpha) img = img.removeAlpha();
    const q = u.slots.has('normal') ? 90 : 85;
    let out = await img.webp({ quality: q, effort: 6, alphaQuality: 90 }).toBuffer();
    // noisy maps compress badly: halve them until they fit a per-texture share of the file budget
    let lim = limit;
    while (out.byteLength > texCap && lim > 256) {
      lim /= 2;
      let im2 = sharp(Buffer.from(tex.getImage())).resize(Math.round(lim), Math.round(lim), { fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true });
      if (!needAlpha) im2 = im2.removeAlpha();
      out = await im2.webp({ quality: q, effort: 6, alphaQuality: 90 }).toBuffer();
    }
    tex.setImage(out).setMimeType('image/webp');
    const base = (tex.getName() || 'tex').replace(/\.[a-z]+$/i, '');
    tex.setName(base).setURI('');
  }
}

// ------------------------------------------------------------------------------------------------
function normaliseRoot(doc, id, log) {
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  let tops = scene.listChildren();
  if (tops.length !== 1) {
    const r = doc.createNode(id);
    for (const t of tops) { scene.removeChild(t); r.addChild(t); }
    scene.addChild(r);
    tops = [r];
    log.push('root node created');
  }
  const root = tops[0];
  root.setName(id);
  const b = F.getBounds(scene);
  const c = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
  if (Math.abs(c[0]) > 0.0005 || Math.abs(c[1]) > 0.0005 || Math.abs(c[2]) > 0.0005) {
    const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -c[0], -c[1], -c[2], 1];
    if (root.getMesh()) F.transformMesh(root.getMesh(), T);
    for (const ch of root.listChildren()) {
      const t = ch.getTranslation();
      ch.setTranslation([t[0] - c[0], t[1] - c[1], t[2] - c[2]]);
    }
    log.push(`re-centred by ${c.map((v) => (v * 1000).toFixed(1)).join('/')} mm`);
  }
  return root;
}

function clearExtras(doc) {
  const r = doc.getRoot();
  for (const list of [r.listNodes(), r.listMeshes(), r.listMaterials(), r.listTextures(), r.listScenes()]) {
    for (const p of list) p.setExtras({});
  }
  r.setExtras({});
}

function describe(doc) {
  const r = doc.getRoot();
  const mats = r.listMaterials();
  return {
    alpha: mats.filter((m) => m.getAlphaMode() !== 'OPAQUE').map((m) => `${m.getName()}:${m.getAlphaMode()}`),
    doubleSided: mats.filter((m) => m.getDoubleSided()).map((m) => m.getName()),
    emissive: mats.filter((m) => m.getEmissiveFactor().some((v) => v > 0)).map((m) => m.getName()),
    materials: mats.length,
    textures: r.listTextures().length,
    nodes: r.listNodes().map((n) => n.getName()),
    drawCalls: r.listNodes().reduce((a, n) => a + (n.getMesh() ? n.getMesh().listPrimitives().length : 0), 0),
  };
}

// ------------------------------------------------------------------------------------------------
async function processAsset(asset) {
  const cls = CFG.classes[asset.class];
  const maxTris = asset.maxTris ?? cls.maxTris;
  const maxTex = asset.maxTex ?? cls.maxTex;
  const maxKB = asset.maxKB ?? cls.maxKB;
  const rawPath = path.join(RAW, `${asset.id}.glb`);
  const info = JSON.parse(fs.readFileSync(path.join(RAW, `${asset.id}.json`), 'utf8'));
  const log = [];
  const notes = new Set();

  const doc = await io.read(rawPath);
  const hints = await applyMaterialHints(doc, notes);
  stripExtensions(doc);
  cleanAttributes(doc);

  // double sided only where the geometry is open (planes, flaps, foil) or alpha-tested
  for (const [mat, ps] of hints) {
    const open = ps.ps_open || 0;
    mat.setDoubleSided(open > 0.01 || mat.getAlphaMode() === 'MASK');
  }

  await doc.transform(F.dedup(), F.prune(), F.weld());
  const sceneObj = doc.getRoot().listScenes()[0];
  const b0 = F.getBounds(sceneObj);
  const diag = Math.hypot(b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2]);
  const simp = simplifyGlobal(doc, maxTris, diag, log, asset.maxErr ?? null);
  // strong simplification (error > 0.3 % of the diagonal): rebuild normals from the reduced surface
  const smoothAngle = asset.smoothAngle ?? (simp.err > diag * 0.003 ? 45 : 0);
  if (smoothAngle > 0) {
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) autoSmoothNormals(doc, prim, smoothAngle);
    await doc.transform(F.prune(), F.weld());
    log.push(`normals rebuilt (auto smooth ${smoothAngle} deg)`);
  }

  const occ = await assignOcclusion(doc, hints);
  if (occ) log.push(`occlusion from ORM on ${occ} materials`);
  await factorizeTextures(doc, notes);
  await doc.transform(F.prune(), F.dedup());
  await doc.transform(F.join({ keepNamed: true }), F.weld(), F.prune());

  const root = normaliseRoot(doc, asset.id, log);
  // Quantisation (KHR_mesh_quantization) stores a dequantisation scale/offset in the transform of the node that
  // holds the mesh. Keep that off the root and off the pivots of movable parts: every mesh goes into its own child
  // node "<name>_mesh", so "<id>" and the part nodes keep clean transforms (position/rotation can be set freely).
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    node.setMesh(null).addChild(doc.createNode(`${node.getName()}_mesh`).setMesh(mesh));
  }
  clearExtras(doc);

  // textures + compression; shrink textures if the file is over its size target
  let scale = 1, bytes = 0, glb;
  const snapshot = F.cloneDocument ? F.cloneDocument(doc) : null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = attempt === 0 || !snapshot ? doc : F.cloneDocument(snapshot);
    statCache.clear();
    await encodeTextures(d, maxTex, scale, Math.max(96, maxKB / 5) * 1024);
    await d.transform(F.prune(), F.dedup({ propertyTypes: [PropertyType.TEXTURE] }));
    await d.transform(F.meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    glb = await io.writeBinary(d);
    bytes = glb.byteLength;
    if (bytes <= maxKB * 1024 || scale <= 0.25) { if (attempt) notes.add(`Texturen auf ${Math.round(maxTex * scale)} px begrenzt`); break; }
    scale /= 2;
  }
  fs.writeFileSync(path.join(OUT, `${asset.id}.glb`), glb);
  if (PREVIEW) {
    const p = await io.readBinary(glb);
    await p.transform(F.dequantize());
    for (const ext of p.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
    fs.writeFileSync(path.join(PREVIEW, `${asset.id}.glb`), await io.writeBinary(p));
  }

  const check = await io.readBinary(glb);
  const sc = check.getRoot().listScenes()[0];
  const bb = F.getBounds(sc);
  const size = [0, 1, 2].map((i) => round(bb.max[i] - bb.min[i]));
  const tris = sceneTris(check);
  const d = describe(check);
  const repo = CFG.repos[asset.src];
  const srcRel = info.source.replace(/\\/g, '/').split(`${repo.replace('/', '__')}/`)[1] || asset.path;
  return {
    id: asset.id, size, tris, bytes, maxTris, maxKB, err_mm: round(simp.err * 1000, 2), tris_in: simp.before,
    source: `${repo}:${srcRel}`, minY: round(bb.min[1], 4), centre: [round((bb.min[0] + bb.max[0]) / 2, 4), round((bb.min[2] + bb.max[2]) / 2, 4)],
    parts: info.parts || [], udim: info.udim, log, notes: [...notes], ...d,
  };
}

const manifestPath = path.join(OUT, 'manifest.json');
const statsPath = path.join(RAW, '_optimize_stats.json');
const MANIFEST_ONLY = argv.includes('--manifest-only');   // rebuild manifest.json from the last run's stats
fs.mkdirSync(OUT, { recursive: true });
if (PREVIEW) fs.mkdirSync(PREVIEW, { recursive: true });
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const stats = fs.existsSync(statsPath) ? JSON.parse(fs.readFileSync(statsPath, 'utf8')) : {};

function manifestEntry(asset, r) {
  const auto = [];
  if (r.tris > r.maxTris) auto.push(`Dreiecksbudget ${r.maxTris} überschritten`);
  if (r.parts.length) auto.push(`Bewegliche Teile als eigene Knoten: ${r.parts.join(', ')}`);
  const short = (list) => (list.length > 4 ? `${list.length} Materialien, z. B. ${list.slice(0, 3).join(', ')}` : list.join(', '));
  if (r.alpha.length) auto.push(`Transparenz (alphaMode): ${short(r.alpha.map((s) => s.replace(':', ' = ')))}`);
  if (r.doubleSided.length) auto.push(`doppelseitige Materialien: ${short(r.doubleSided)}`);
  if (r.emissive.length) auto.push(`leuchtend (emissive): ${short(r.emissive)}`);
  if (r.udim) auto.push(`UDIM-Kacheln (${r.udim.tiles}) zu Texturatlas zusammengefasst`);
  return {
    file: `${asset.id}.glb`,
    source: r.source,
    size: r.size,
    tris: r.tris,
    bytes: r.bytes,
    front: asset.front || 'n/a',
    license: 'CC-BY-4.0',
    notes: [asset.notes, ...r.notes, ...auto].filter(Boolean).join('; '),
  };
}

for (const asset of CFG.assets) {
  if (ONLY.size && !ONLY.has(asset.id)) continue;
  if (MANIFEST_ONLY) {
    if (stats[asset.id] && fs.existsSync(path.join(OUT, `${asset.id}.glb`))) manifest[asset.id] = manifestEntry(asset, stats[asset.id]);
    continue;
  }
  if (!fs.existsSync(path.join(RAW, `${asset.id}.glb`))) { console.log(`${asset.id}: no raw GLB, skipped`); continue; }
  const t0 = Date.now();
  try {
    const r = await processAsset(asset);
    stats[asset.id] = r;
    manifest[asset.id] = manifestEntry(asset, r);
    console.log(`${asset.id.padEnd(22)} ${String(r.tris).padStart(6)} tris (in ${r.tris_in}, err ${r.err_mm} mm)  ${(r.bytes / 1024).toFixed(0).padStart(5)} KB  size ${r.size.join(' x ')}  mats ${r.materials} tex ${r.textures} dc ${r.drawCalls}  ${((Date.now() - t0) / 1000).toFixed(1)}s ${r.tris > r.maxTris ? 'OVER BUDGET' : ''}`);
  } catch (e) {
    console.log(`${asset.id}: FAILED ${e.stack || e}`);
  }
}
const ordered = {};
for (const a of CFG.assets) if (manifest[a.id]) ordered[a.id] = manifest[a.id];
fs.writeFileSync(manifestPath, JSON.stringify(ordered, null, 2) + '\n');
if (!MANIFEST_ONLY) fs.writeFileSync(statsPath, JSON.stringify(stats, null, 1));
