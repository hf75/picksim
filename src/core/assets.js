// Laden der konvertierten NVIDIA-SimReady-Modelle (GLB, meshopt-komprimiert),
// Klonen, Instanzieren und Platzhalter, falls ein Modell fehlt.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

// Der meshopt-Decoder (WebAssembly) wird erst geladen, wenn ein Modell ihn wirklich braucht.
// So läuft PickSim auch dort, wo WebAssembly gesperrt ist (Artifact-Fassung mit unkomprimierten Modellen).
const lazyMeshopt = {
  supported: true,
  async decodeGltfBufferAsync(count, stride, source, mode, filter) {
    const { MeshoptDecoder: d } = await import('three/addons/libs/meshopt_decoder.module.js');
    await d.ready;
    if (d.decodeGltfBufferAsync) return d.decodeGltfBufferAsync(count, stride, source, mode, filter);
    const out = new Uint8Array(count * stride);
    d.decodeGltfBuffer(out, count, stride, source, mode, filter);
    return out;
  },
};

export class Assets {
  constructor(engine) {
    this.engine = engine;
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(lazyMeshopt);
    this.base = 'assets/models/';
    this.cache = new Map();      // id → Promise<template|null>
    this.templates = new Map();  // id → template (geladen)
    this.manifest = {};
  }

  async loadManifest() {
    try {
      const r = await fetch(this.base + 'manifest.json', { cache: 'no-cache' });
      if (r.ok) this.manifest = await r.json();
    } catch (e) { this.manifest = {}; }
    return this.manifest;
  }

  has(id) { return !!this.manifest[id]; }
  info(id) { return this.manifest[id] || null; }

  load(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const info = this.manifest[id];
    const p = !info ? Promise.resolve(null) : new Promise(resolve => {
      this._loadGLTF(this.base + (info.file || id + '.glb')).then(gltf => {
        const root = gltf.scene;
        root.name = id;
        root.traverse(o => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              if (!m) continue;
              for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
                if (m[k]) m[k].anisotropy = 4;
              }
              if (m.transparent && m.opacity > 0.98 && !m.alphaMap && !(m.map && m.map.format === THREE.RGBAFormat)) m.transparent = false;
            }
          }
        });
        _box.setFromObject(root);
        root.userData.size = _box.getSize(new THREE.Vector3());
        root.userData.min = _box.min.clone();
        this.templates.set(id, root);
        resolve(root);
      }).catch(err => { console.warn('Modell fehlt/defekt:', id, err && err.message); resolve(null); });
    });
    this.cache.set(id, p);
    return p;
  }

  // Die Artifact-Fassung liefert jedes Modell als gzip-komprimierte GLB in Base64-Text (<id>.glb.gz.txt,
  // siehe tools/build-artifact.mjs), weil claude.ai dort nur Web-Dateitypen ausliefert.
  async _loadGLTF(url) {
    if (!url.endsWith('.gz.txt')) return this.loader.loadAsync(url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} für ${url}`);
    const text = (await r.text()).trim();
    let bytes;
    if (Uint8Array.fromBase64) bytes = Uint8Array.fromBase64(text);
    else { const bin = atob(text); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
    const glb = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return this._packedLoader().parseAsync(glb, this.base);
  }

  // Eigener Lader für verpackte Modelle: Er dekodiert die eingebetteten Bilder direkt aus den Modelldaten.
  // Der normale Weg über blob:-Adressen kann im Artifact-Rahmen gesperrt sein.
  // GLTFLoader übergibt Bilddaten aus dem GLB an Lader mit isKTX2Loader unmittelbar per parse().
  _packedLoader() {
    if (this._packed) return this._packed;
    const inlineImages = {
      isKTX2Loader: true,
      parse(view, onLoad, onError) {
        const h = new Uint8Array(view, 0, Math.min(12, view.byteLength));
        const type = h[0] === 0x89 && h[1] === 0x50 ? 'image/png' : h[0] === 0xff && h[1] === 0xd8 ? 'image/jpeg'
          : h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50 ? 'image/webp' : '';
        createImageBitmap(new Blob([view], { type }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
          .then(bmp => { const t = new THREE.Texture(bmp); t.needsUpdate = true; onLoad(t); }, onError);
      },
      load(url, onLoad, onProgress, onError) { new THREE.TextureLoader().load(url, onLoad, onProgress, onError); },
    };
    this._packed = new GLTFLoader();
    this._packed.setMeshoptDecoder(lazyMeshopt);
    this._packed.register(parser => { parser.textureLoader = inlineImages; return { name: 'picksim_inline_images' }; });
    return this._packed;
  }

  async preload(ids, onProgress) {
    let done = 0;
    const list = [...new Set(ids)];
    await Promise.all(list.map(id => this.load(id).then(() => { done++; onProgress && onProgress(done / list.length, id); })));
  }

  /** Klon eines geladenen Modells (teilt Geometrie & Material). Falls nicht vorhanden: Platzhalterbox. */
  get(id, { fallbackSize = null, color = 0x8a8f96 } = {}) {
    const t = this.templates.get(id);
    if (t) {
      const c = t.clone(true);
      c.userData.size = t.userData.size.clone();
      c.userData.assetId = id;
      return c;
    }
    const info = this.manifest[id];
    const s = fallbackSize || (info && info.size) || [0.4, 0.4, 0.4];
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    m.position.y = s[1] / 2;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    g.userData.size = new THREE.Vector3(...s);
    g.userData.placeholder = true;
    g.userData.assetId = id;
    return g;
  }

  size(id) {
    const t = this.templates.get(id);
    if (t) return t.userData.size.clone();
    const info = this.manifest[id];
    return info ? new THREE.Vector3(...info.size) : new THREE.Vector3(0.4, 0.4, 0.4);
  }

  /**
   * Viele Kopien als InstancedMesh (ein Draw-Call pro Teilnetz).
   * placements: Array von THREE.Matrix4 oder {x,y,z,ry,sx,sy,sz}
   */
  instanced(id, placements, { castShadow = true, receiveShadow = true, fallbackSize = null, color } = {}) {
    const src = this.templates.get(id) || this.get(id, { fallbackSize, color });
    const group = new THREE.Group();
    group.name = 'inst-' + id;
    const mats = placements.map(p => p.isMatrix4 ? p : composeMatrix(p));
    src.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(src.matrixWorld).invert();
    src.traverse(o => {
      if (!o.isMesh) return;
      const local = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
      const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
      const tmp = new THREE.Matrix4();
      mats.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, local)));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = castShadow;
      im.receiveShadow = receiveShadow;
      im.computeBoundingSphere();
      im.computeBoundingBox && im.computeBoundingBox();
      group.add(im);
    });
    return group;
  }
}

export function composeMatrix({ x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1, sx, sy, sz }) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx ?? s, sy ?? s, sz ?? s));
  return m;
}

/** Objekt nicht-uniform auf Zielmaße skalieren (z. B. Palette exakt 1,2 × 0,8 m) */
export function scaleTo(obj, sx, sy, sz) {
  _box.setFromObject(obj);
  const size = _box.getSize(_v);
  obj.scale.set(
    sx ? obj.scale.x * sx / size.x : obj.scale.x,
    sy ? obj.scale.y * sy / size.y : obj.scale.y,
    sz ? obj.scale.z * sz / size.z : obj.scale.z,
  );
  return obj;
}

/** Bodenmittig ausrichten: Unterkante auf y=0, Mitte auf x/z=0 */
export function groundCenter(obj) {
  obj.updateMatrixWorld(true);
  _box.setFromObject(obj);
  const c = _box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= _box.min.y;
  return obj;
}
