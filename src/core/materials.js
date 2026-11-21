// PBR-Materialbibliothek: CC0-Texturen (Poly Haven/ambientCG) + prozedurale Canvas-Texturen.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();

export class MaterialLib {
  constructor(engine) {
    this.engine = engine;
    this.base = 'assets/textures/';
    this.texCache = new Map();
    this.matCache = new Map();
    this.pending = new Set();
    this.disposables = [];
    this.anisotropy = Math.min(engine.renderer.capabilities.getMaxAnisotropy(), engine.quality.maxAniso || 8);
  }

  _load(url, srgb) {
    const key = url + (srgb ? '|s' : '');
    if (this.texCache.has(key)) return this.texCache.get(key);
    const entry = { tex: null, promise: null };
    entry.promise = new Promise(resolve => {
      const t = loader.load(url, tex => resolve(tex), undefined, () => { entry.failed = true; resolve(null); });
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.anisotropy;
      entry.tex = t;
    });
    this.pending.add(entry.promise);
    entry.promise.then(() => this.pending.delete(entry.promise));
    this.texCache.set(key, entry);
    return entry;
  }

  /**
   * Einzelne Textur eines Sets laden, z. B. texture('fabric_canvas', 'normal').
   * Gibt sofort eine (anfangs leere) Textur zurück; .promise liefert die geladene Textur oder null.
   */
  texture(role, name, { srgb = name === 'albedo', repeat = [1, 1] } = {}) {
    const e = this._load(`${this.base}${role}/${name}.webp`, srgb);
    const t = e.tex.clone();
    t.repeat.set(repeat[0], repeat[1]);
    t.promise = e.promise.then(src => { if (src) { t.image = src.image; t.needsUpdate = true; } return src ? t : null; });
    return t;
  }

  /** Wartet, bis alle angestoßenen Texturen geladen (oder gescheitert) sind */
  async ready() { while (this.pending.size) await Promise.all([...this.pending]); }

  /**
   * PBR-Material aus einem Textur-Set assets/textures/<role>/{albedo,normal,arm}.webp
   * opts: repeat [u,v], color (Tönung), roughness, metalness, normalScale, aoIntensity, envMapIntensity
   */
  pbr(role, opts = {}) {
    const rep = opts.repeat || [1, 1];
    const key = role + JSON.stringify(opts);
    if (this.matCache.has(key)) return this.matCache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: opts.color != null ? opts.color : 0xffffff,
      roughness: opts.roughness != null ? opts.roughness : 1,
      metalness: opts.metalness != null ? opts.metalness : 1,
      envMapIntensity: opts.envMapIntensity != null ? opts.envMapIntensity : 1,
      side: opts.side || THREE.FrontSide,
    });
    m.name = role;
    const fallback = opts.fallbackColor != null ? opts.fallbackColor : null;
    const apply = (name, prop, srgb) => {
      const e = this._load(`${this.base}${role}/${name}.webp`, srgb);
      e.promise.then(tex => {
        if (!tex) {
          if (prop === 'map' && fallback != null) m.color.set(fallback);
          if (prop === 'roughnessMap') { m.roughness = opts.fallbackRoughness ?? 0.8; m.metalness = opts.fallbackMetalness ?? 0; }
          m.needsUpdate = true;
          return;
        }
        const t = tex.clone();
        t.repeat.set(rep[0], rep[1]);
        if (opts.offset) t.offset.set(opts.offset[0], opts.offset[1]);
        if (opts.rotation) { t.rotation = opts.rotation; t.center.set(0.5, 0.5); }
        t.needsUpdate = true;
        m[prop] = t;
        if (prop === 'normalMap') m.normalScale.set(opts.normalScale ?? 1, opts.normalScale ?? 1);
        if (prop === 'aoMap') m.aoMapIntensity = opts.aoIntensity ?? 1;
        m.needsUpdate = true;
      });
    };
    apply('albedo', 'map', true);
    apply('normal', 'normalMap', false);
    if (opts.noArm !== true) {
      apply('arm', 'roughnessMap', false);
      apply('arm', 'metalnessMap', false);
      if (opts.ao !== false) apply('arm', 'aoMap', false);
    }
    this.matCache.set(key, m);
    return m;
  }

  /** einfaches PBR-Material (gecacht) */
  basic(color, roughness = 0.7, metalness = 0, extra = {}) {
    const key = `b|${color}|${roughness}|${metalness}|${JSON.stringify(extra)}`;
    if (this.matCache.has(key)) return this.matCache.get(key);
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    this.matCache.set(key, m);
    return m;
  }

  emissive(color, intensity = 2, extra = {}) {
    const key = `e|${color}|${intensity}|${JSON.stringify(extra)}`;
    if (this.matCache.has(key)) return this.matCache.get(key);
    const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.5, metalness: 0, ...extra });
    this.matCache.set(key, m);
    return m;
  }

  /** Canvas → Textur (sRGB) */
  canvasTex(canvas, { repeat = [1, 1], srgb = true, aniso = true, mip = true } = {}) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    if (aniso) t.anisotropy = this.anisotropy;
    if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    this.disposables.push(t);
    return t;
  }

  /** Lochung eines Regalständers (Stanzbild) */
  uprightTexture(color = '#1f4fa3') {
    const key = 'upright' + color;
    if (this.matCache.has(key)) return this.matCache.get(key);
    const c = document.createElement('canvas'); c.width = 64; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 64, 512);
    // leichte Lackvariation
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * 64, Math.random() * 512, 2, 6); }
    g.fillStyle = '#0b0d10';
    for (let y = 8; y < 512; y += 25.6) {
      // Tropfenlochung
      g.beginPath(); g.ellipse(20, y + 6, 4, 7, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(44, y + 6, 4, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(29, y + 2, 6, 3);
    }
    const t = this.canvasTex(c);
    this.matCache.set(key, t);
    return t;
  }

  /** Gitterrost (Alpha) */
  wireDeckTexture() {
    if (this.matCache.has('wiredeck')) return this.matCache.get('wiredeck');
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = '#fff'; g.lineWidth = 5;
    for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); }
    g.lineWidth = 3;
    for (let i = 0; i <= 128; i += 64) { g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
    const t = this.canvasTex(c);
    this.matCache.set('wiredeck', t);
    return t;
  }

  /** Warnstreifen gelb/schwarz */
  hazardTexture() {
    if (this.matCache.has('hazard')) return this.matCache.get('hazard');
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#f2c21b'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#16181b';
    for (let i = -128; i < 256; i += 64) { g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 32, 128); g.lineTo(i + 160, 0); g.lineTo(i + 128, 0); g.closePath(); g.fill(); }
    const t = this.canvasTex(c);
    this.matCache.set('hazard', t);
    return t;
  }

  /** Rauschen/Schmutz für Rauheit oder Tönung */
  grungeTexture(seed = 1, size = 256, contrast = 0.35) {
    const key = `grunge${seed}|${size}|${contrast}`;
    if (this.matCache.has(key)) return this.matCache.get(key);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#808080'; g.fillRect(0, 0, size, size);
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < size * 3; i++) {
      const r = rnd() * size * 0.08 + 2;
      const v = Math.floor(128 + (rnd() - 0.5) * 255 * contrast);
      g.fillStyle = `rgba(${v},${v},${v},0.25)`;
      g.beginPath(); g.arc(rnd() * size, rnd() * size, r, 0, 7); g.fill();
    }
    const t = this.canvasTex(c, { srgb: false });
    this.matCache.set(key, t);
    return t;
  }

  dispose() {
    for (const t of this.disposables) t.dispose();
    this.disposables = [];
  }
}
