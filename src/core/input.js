// Eingabe-Abstraktion für Desktop (Tastatur/Maus) und WebXR (Quest-Controller).
// Aktionen: primary (Nehmen/Ablegen/Scannen/Drücken), secondary (Zurücklegen/Rückgängig),
// grab (Greiftaste), device (Gerät/Liste zeigen), cart (Wagen koppeln), confirm, help, menu, number (1–9)
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

export class Input extends THREE.EventDispatcher {
  constructor(engine) {
    super();
    this.engine = engine;
    this.el = engine.renderer.domElement;
    this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.locked = false;
    this.gameActive = false;     // true während eine Mission läuft (Pointer-Lock gewünscht)
    this.sensitivity = 0.0022;
    this.invertY = false;
    this._snapArmed = true;
    this.snapAngle = THREE.MathUtils.degToRad(30);
    this.lastController = null;

    // Ersatz, falls der Browser/Rahmen den Mausfang (Pointer Lock) verweigert:
    // Umsehen mit gedrückter Maustaste, kurzer Klick ohne Ziehen = Aktion.
    this.dragLook = false;
    this._drag = null;

    window.addEventListener('keydown', e => this._onKey(e, true));
    window.addEventListener('keyup', e => this._onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this._drag = null; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      this.dispatchEvent({ type: 'lockchange', locked: this.locked });
    });
    document.addEventListener('pointerlockerror', () => this._enableDragLook());
    // Am Fenster lauschen: Beim Ziehen-Umsehen verlässt der Zeiger oft die 3D-Fläche (HUD, Rand, außerhalb des Rahmens)
    window.addEventListener('mousemove', e => {
      if (this._drag && !this.locked && e.buttons === 0) { this._drag = null; return; }   // außerhalb losgelassen
      if (this.locked || (this.dragLook && this._drag)) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
        if (this._drag) this._drag.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      }
    });
    this.el.addEventListener('mousedown', e => {
      if (this.engine.isXR) return;
      if (this.locked) {
        if (e.button === 0) this._emit('primary', { source: 'mouse' });
        if (e.button === 2) this._emit('secondary', { source: 'mouse' });
        return;
      }
      if (this.dragLook && this.gameActive) { this._drag = { button: e.button, moved: 0 }; return; }
      if (this.gameActive) this.lock();
    });
    window.addEventListener('mouseup', e => {
      const d = this._drag;
      if (!d) return;
      this._drag = null;
      if (d.moved < 6 && this.gameActive && !this.engine.isXR) {      // Klick, nicht gezogen
        if (d.button === 0) this._emit('primary', { source: 'mouse' });
        if (d.button === 2) this._emit('secondary', { source: 'mouse' });
      }
    });
    this.el.addEventListener('contextmenu', e => e.preventDefault());
    this.el.addEventListener('wheel', e => {
      if (this.lookActive) this._emit('wheel', { delta: Math.sign(e.deltaY) });
    }, { passive: true });

    this._setupXR();
  }

  /** Blicksteuerung aktiv? (Mausfang oder Ersatzmodus „Ziehen zum Umsehen“) */
  get lookActive() { return this.locked || (this.dragLook && this.gameActive); }

  _enableDragLook() {
    if (this.dragLook) return;
    this.dragLook = true;
    this.dispatchEvent({ type: 'lockfallback' });
    this.dispatchEvent({ type: 'lockchange', locked: this.locked });
  }

  lock() {
    if (this.engine.isXR || this.dragLook) return;
    try {
      if (!this.el.requestPointerLock) { this._enableDragLook(); return; }
      const p = this.el.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => this._enableDragLook());
    } catch (e) { this._enableDragLook(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  _onKey(e, down) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const code = e.code;
    if (down) {
      if (!this.keys.has(code)) this._keyPressed(code, e);
      this.keys.add(code);
      if (this.lookActive && (code === 'Tab' || code === 'Space')) e.preventDefault();
    } else {
      this.keys.delete(code);
    }
  }

  _keyPressed(code, e) {
    if (this.engine.isXR) return;
    const map = {
      KeyE: 'primary', KeyQ: 'secondary', KeyR: 'secondary', Tab: 'device', KeyF: 'cart',
      Space: 'confirm', Enter: 'confirm', KeyH: 'help', Escape: 'menu', KeyP: 'menu', KeyM: 'map',
    };
    if (code.startsWith('Digit') && code.length === 6) {
      this._emit('number', { value: Number(code.slice(5)), source: 'key' });
      return;
    }
    const a = map[code];
    if (a) this._emit(a, { source: 'key', shift: e.shiftKey });
  }

  _emit(type, detail = {}) {
    this.dispatchEvent({ type: 'action', action: type, ...detail });
    this.dispatchEvent({ type, ...detail });
  }

  /** Bewegungsvektor (x = rechts, y = vorwärts), Länge ≤ 1 */
  moveVector(out = new THREE.Vector2()) {
    out.set(0, 0);
    if (this.engine.isXR) {
      const gp = this._gamepad('left');
      if (gp && gp.axes.length >= 4) {
        const x = gp.axes[2], y = gp.axes[3];
        const m = Math.hypot(x, y);
        if (m > 0.18) out.set(x, -y).multiplyScalar(Math.min(1, (m - 0.18) / 0.72) / m);
      }
      return out;
    }
    if (!this.gameActive) return out;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) out.y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) out.y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) out.x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) out.x -= 1;
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  // ---------------- WebXR ----------------
  _setupXR() {
    const r = this.engine.renderer;
    const rig = this.engine.rig;
    const factory = new XRControllerModelFactory();
    this.controllers = [];
    for (let i = 0; i < 2; i++) {
      const ray = r.xr.getController(i);
      const grip = r.xr.getControllerGrip(i);
      const entry = { index: i, ray, grip, handedness: null, source: null, buttons: [], model: null, pointer: null };
      ray.userData.entry = entry;
      ray.addEventListener('connected', e => {
        entry.source = e.data;
        entry.handedness = e.data.handedness;
        entry.buttons = [];
        this.dispatchEvent({ type: 'controllerconnected', entry });
      });
      ray.addEventListener('disconnected', () => {
        entry.source = null;
        this.dispatchEvent({ type: 'controllerdisconnected', entry });
      });
      ray.addEventListener('selectstart', () => { this.lastController = entry; this._emit('primary', { source: 'xr', controller: entry }); });
      ray.addEventListener('squeezestart', () => { this.lastController = entry; this._emit('grab', { source: 'xr', controller: entry }); });
      ray.addEventListener('squeezeend', () => this._emit('release', { source: 'xr', controller: entry }));
      try { entry.model = factory.createControllerModel(grip); grip.add(entry.model); } catch (e) { /* offline */ }

      // Zeigestrahl
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
      line.name = 'ray';
      line.scale.z = 3;
      ray.add(line);
      // Zeigepunkt immer obenauf (auch auf Tafeln, die im Notfall vor alles gezeichnet werden)
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
      dot.renderOrder = 45;
      dot.visible = false;
      ray.add(dot);
      entry.line = line; entry.dot = dot;

      rig.add(ray);
      rig.add(grip);
      this.controllers.push(entry);
    }
  }

  controller(handedness) {
    return this.controllers.find(c => c.handedness === handedness && c.source) || null;
  }

  _gamepad(handedness) {
    const c = this.controller(handedness);
    return c && c.source && c.source.gamepad ? c.source.gamepad : null;
  }

  /** pro Frame: XR-Knöpfe und Sticks abfragen */
  update() {
    if (!this.engine.isXR) return;
    for (const c of this.controllers) {
      const gp = c.source && c.source.gamepad;
      if (!gp) continue;
      const prev = c.buttons;
      const now = gp.buttons.map(b => b.pressed);
      const edge = i => now[i] && !prev[i];
      // A / X (Index 4) = zurücklegen / Rückgängig ; B / Y (Index 5) = Gerät/Liste
      if (edge(4)) { this.lastController = c; this._emit(c.handedness === 'left' ? 'confirm' : 'secondary', { source: 'xr', controller: c }); }
      if (edge(5)) this._emit(c.handedness === 'left' ? 'device' : 'menu', { source: 'xr', controller: c });
      if (edge(3)) this._emit(c.handedness === 'left' ? 'cart' : 'help', { source: 'xr', controller: c });
      c.buttons = now;
    }
    // Snap-Turn mit rechtem Stick
    const gp = this._gamepad('right');
    if (gp && gp.axes.length >= 4) {
      const x = gp.axes[2];
      if (Math.abs(x) > 0.7 && this._snapArmed) {
        this._snapArmed = false;
        this.dispatchEvent({ type: 'snapturn', angle: x > 0 ? -this.snapAngle : this.snapAngle });
      } else if (Math.abs(x) < 0.3) this._snapArmed = true;
    }
  }

  /** kurze Vibration am Controller */
  pulse(entry, intensity = 0.4, ms = 40) {
    const src = entry && entry.source;
    const h = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
    if (h && h.pulse) { try { h.pulse(intensity, ms); } catch (e) { /* ignore */ } }
  }
}
