// Renderer, Kamera-Rig, Qualitätsstufen, Post-Processing und Haupt-Loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// Kein Bloom/Leuchtschein: Lampen und Fenster sollen klar und ohne Lichthof erscheinen.
export const QUALITY = {
  low:    { key: 'low',    label: 'Niedrig (schwache PCs)', pixelRatio: 1,    shadows: true,  shadowSize: 1024, post: false, ao: false, envSize: 128, particles: false, maxAniso: 2 },
  medium: { key: 'medium', label: 'Mittel',                 pixelRatio: 1,    shadows: true,  shadowSize: 2048, post: false, ao: false, envSize: 256, particles: true,  maxAniso: 4 },
  high:   { key: 'high',   label: 'Hoch',                   pixelRatio: 1.5,  shadows: true,  shadowSize: 2048, post: true,  ao: true,  envSize: 256, particles: true,  maxAniso: 8 },
  ultra:  { key: 'ultra',  label: 'Ultra',                  pixelRatio: 2,    shadows: true,  shadowSize: 4096, post: true,  ao: true,  envSize: 512, particles: true,  maxAniso: 16 },
};
// Einstellungen, die während einer VR-Sitzung gelten (Meta Quest 3).
export const XR_QUALITY = { key: 'xr', label: 'VR', shadows: true, shadowSize: 1024, post: false, ao: false, envSize: 128, particles: false, maxAniso: 4 };

export function detectQuality() {
  const ua = navigator.userAgent || '';
  if (/OculusBrowser|Quest|Pico|Android|iPhone|iPad/i.test(ua)) return 'low';
  try {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c && c.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(c.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/SwiftShader|llvmpipe|Microsoft Basic|Software/i.test(gpu)) return 'low';
    if (/RTX|Radeon RX|RX \d{3,4}|Radeon\(TM\) [78]\d0M|Arc|Apple M\d/i.test(gpu)) return 'high';
    if (/Intel|UHD|HD Graphics|Iris|Mali|Adreno|PowerVR|Vega/i.test(gpu)) return 'medium';
  } catch (e) { /* ignore */ }
  return 'high';
}
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

export class Engine extends THREE.EventDispatcher {
  constructor(container, qualityKey = 'medium') {
    super();
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFoveation(0.5);
    container.appendChild(r.domElement);
    r.domElement.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f14);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.03, 260);
    this.camera.rotation.order = 'YXZ';
    this.eyeHeight = 1.66;
    this.camera.position.set(0, this.eyeHeight, 0);
    this.rig = new THREE.Group();
    this.rig.name = 'player-rig';
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.time = 0;
    this.updaters = [];
    this.composer = null;
    this.paused = false;
    this.fps = 60;
    this._fpsAcc = 0; this._fpsFrames = 0;

    this.setQuality(qualityKey);

    window.addEventListener('resize', () => this.resize());
    r.xr.addEventListener('sessionstart', () => this._onXRStart());
    r.xr.addEventListener('sessionend', () => this._onXREnd());
    this.resize();
    r.setAnimationLoop((t, frame) => this._tick(t, frame));
  }

  get isXR() { return this.renderer.xr.isPresenting; }
  /** aktuell wirksame Qualitätsstufe (VR überschreibt Desktop-Stufe) */
  get q() { return this.isXR ? XR_QUALITY : this.quality; }

  setQuality(key) {
    this.quality = QUALITY[key] || QUALITY.medium;
    this.qualityKey = this.quality.key;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this._buildComposer();
    this.resize();
    this.dispatchEvent({ type: 'quality', quality: this.quality });
  }

  _buildComposer() {
    if (this.composer) {
      this.composer.passes.forEach(p => p.dispose && p.dispose());
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.composer = null;
    }
    const q = this.quality;
    if (!q.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      // Sprites (Infopunkte) und durchsichtige Flächen ohne Tiefenschreiben (Folien, Lichtzeiger) werfen keine
      // Verdeckung – sonst zeichnet GTAO ihr Rechteck als dunkles Quadrat in die Wand dahinter.
      ao._overrideVisibility = function () {
        const cache = this._visibilityCache;
        this.scene.traverse(o => {
          if (!o.visible) return;
          const m = o.material;
          const soft = o.isPoints || o.isLine || o.isLine2 || o.isSprite || (m && !Array.isArray(m) && m.transparent && m.depthWrite === false);
          if (soft) { o.visible = false; cache.push(o); }
        });
      };
      composer.addPass(ao);
      this.aoPass = ao;
    }
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (this.isXR) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  /** Registriert eine Update-Funktion (dt, time). Gibt eine Abmeldefunktion zurück. */
  onUpdate(fn, order = 0) {
    const entry = { fn, order };
    this.updaters.push(entry);
    this.updaters.sort((a, b) => a.order - b.order);
    return () => { const i = this.updaters.indexOf(entry); if (i >= 0) this.updaters.splice(i, 1); };
  }

  _tick(t, frame) {
    this.timer.update(t);
    let dt = this.timer.getDelta();
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this._fpsAcc += dt; this._fpsFrames++;
    if (this._fpsAcc > 0.5) { this.fps = this._fpsFrames / this._fpsAcc; this._fpsAcc = 0; this._fpsFrames = 0; }
    this.frame = frame;
    for (let i = 0; i < this.updaters.length; i++) {
      try { this.updaters[i].fn(dt, this.time, frame); } catch (e) { console.error(e); }
    }
    if (this.composer && !this.isXR) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  _onXRStart() {
    this._savedCam = { pos: this.camera.position.clone(), rot: this.camera.rotation.clone() };
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this._setShadowSize(XR_QUALITY.shadowSize);
    this.dispatchEvent({ type: 'xrstart' });
    this.dispatchEvent({ type: 'quality', quality: XR_QUALITY });
  }

  _onXREnd() {
    this.camera.position.set(0, this.eyeHeight, 0);
    this.camera.rotation.set(this._savedCam ? this._savedCam.rot.x : 0, 0, 0);
    this._setShadowSize(this.quality.shadowSize);
    this.resize();
    this.dispatchEvent({ type: 'xrend' });
    this.dispatchEvent({ type: 'quality', quality: this.quality });
  }

  /** Schattenauflösung aller Lichter anpassen (VR: kleiner für flüssige Bildrate) */
  _setShadowSize(size) {
    this.scene.traverse(o => {
      if (o.isLight && o.castShadow && o.shadow && o.shadow.mapSize.x !== size) {
        o.shadow.mapSize.set(size, size);
        if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
      }
    });
  }

  /** Weltposition des Kopfes (Kamera). */
  headPosition(target = new THREE.Vector3()) {
    return this.camera.getWorldPosition(target);
  }

  /** Blickrichtung des Kopfes als Gierwinkel (um Y) in Welt-Koordinaten. */
  headYaw() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return Math.atan2(-d.x, -d.z);
  }
}
